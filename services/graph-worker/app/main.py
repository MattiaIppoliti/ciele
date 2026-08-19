"""Ciele Graph Knowledge worker, a thin FastAPI wrapper over the cognee library.

Exposes exactly the operations the Ciele app's adapter
(`apps/web/src/lib/runtime/graph-worker.ts`) speaks, and nothing else:

    GET  /health                     -> 200, no auth (server liveness)
    POST /ingest    {dataset, collection_id, documents[]}  -> add + cognify
    POST /remove    {dataset, concept_id}                  -> drop a document
    POST /purge     {dataset}                              -> drop the whole dataset
    POST /search    {dataset, query, mode, session_id, top_k} -> answer + provenance
    POST /feedback  {dataset, session_id, qa_id, score, text} -> record a score
    POST /improve   {dataset, session_ids, distill}        -> weights (+ distill)

Auth model mirrors the crawler worker: a single static operator token
(`GRAPH_WORKER_API_TOKEN`) sent as `Authorization: Bearer <token>`. Every route
except /health is fail-closed, the server refuses to boot without the token, so
it can never come up accidentally open. This service is never reached by
browsers; only the Ciele app's server side calls it, behind private ingress.

The graph is a DERIVED index over OKF Concepts (ADR-0017): each Knowledge
Collection is one cognee dataset, and every document is tagged with its
originating `concept::<id>` / `source::<id>` node-set entries so a search result
maps back to a Concept -> Source citation (never an opaque chunk, the ADR-0002
invariant). The exact cognee calls here are the ones proven in the spike
(`docs/research/cognee-spike.md` / `docs/research/cognee-spike/spike.py`).

A load-bearing rule from the spike: a graph read outside the dataset's
multi-tenant context silently returns an empty default graph. Every read here
goes through `_dataset_graph()`, which opens that context first; there is no
dataset-less code path.
"""

import contextvars
import os
import secrets
from contextlib import asynccontextmanager, contextmanager
from typing import Any, Optional

# Telemetry and connection posture must be set before importing cognee.
os.environ.setdefault("TELEMETRY_DISABLED", "1")
os.environ.setdefault("COGNEE_SKIP_CONNECTION_TEST", "true")

import cognee  # noqa: E402
import litellm  # noqa: E402  (cognee dependency, every cognee LLM call routes through it)
from cognee import SearchType  # noqa: E402
from cognee.api.v1.session.session import add_feedback, get_session  # noqa: E402
from fastapi import Depends, FastAPI, Header, HTTPException  # noqa: E402
from litellm.integrations.custom_logger import CustomLogger  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

TOKEN_ENV = "GRAPH_WORKER_API_TOKEN"
CONCEPT_TAG = "concept::"
SOURCE_TAG = "source::"

# cognee graph edges are (source_id, target_id, relationship, properties) tuples;
# the properties dict is index 3. A freshly-built edge carries the neutral
# feedback weight; anything else means feedback moved it.
EDGE_PROPS_INDEX = 3
NEUTRAL_FEEDBACK_WEIGHT = 0.5


# ---- LLM usage accounting ----------------------------------------------------
#
# cognee never surfaces the token usage of the LLM calls it makes internally
# (cognify entity extraction, graph-completion answers, session guidance,
# distillation), but every one of them goes through litellm. A litellm success
# callback captures each call's usage into a per-request ContextVar collector,
# and /ingest, /search and /improve report the aggregate back to the Ciele app
# as a `usage` object so the runtime can meter it into the ai_usage ledger.
#
# Best-effort by design: litellm fires async success callbacks as a task inside
# the calling request's context, so calls land in the right collector, but a
# provider/path that bypasses litellm (or a callback racing the response) just
# under-counts; it never fails a request.

_LLM_CALLS: contextvars.ContextVar[Optional[list[dict[str, Any]]]] = contextvars.ContextVar(
    "ciele_llm_calls", default=None
)


def _usage_number(obj: Any, key: str) -> int:
    value = getattr(obj, key, None)
    if value is None and isinstance(obj, dict):
        value = obj.get(key)
    return int(value) if isinstance(value, (int, float)) else 0


def _record_llm_call(kwargs: dict[str, Any], response_obj: Any) -> None:
    calls = _LLM_CALLS.get()
    if calls is None:
        return  # no collector active (not inside a tracked route)
    usage = getattr(response_obj, "usage", None)
    if usage is None and isinstance(response_obj, dict):
        usage = response_obj.get("usage")
    model = (
        getattr(response_obj, "model", None)
        or kwargs.get("model")
        or os.environ.get("LLM_MODEL", "")
    )
    calls.append(
        {
            "model": str(model),
            "input_tokens": _usage_number(usage, "prompt_tokens"),
            "output_tokens": _usage_number(usage, "completion_tokens"),
        }
    )


class _UsageTracker(CustomLogger):
    """Appends every successful litellm call's token usage to the active
    request's collector. Registered once at boot; a no-op outside tracked
    routes and never raises (litellm isolates logger errors anyway)."""

    def log_success_event(self, kwargs, response_obj, start_time, end_time):  # noqa: ANN001
        _record_llm_call(kwargs, response_obj)

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):  # noqa: ANN001
        _record_llm_call(kwargs, response_obj)


@contextmanager
def _collect_llm_usage():
    """Scopes an LLM-usage collector to the current request context."""
    calls: list[dict[str, Any]] = []
    token = _LLM_CALLS.set(calls)
    try:
        yield calls
    finally:
        _LLM_CALLS.reset(token)


def _usage_summary(calls: list[dict[str, Any]]) -> dict[str, Any]:
    """The `usage` object returned to the Ciele app: flat totals plus the
    model/provider that ran, so the runtime can attribute the ledger row."""
    return {
        "input_tokens": sum(c["input_tokens"] for c in calls),
        "output_tokens": sum(c["output_tokens"] for c in calls),
        "llm_calls": len(calls),
        "model": calls[-1]["model"] if calls else os.environ.get("LLM_MODEL", ""),
        "provider": os.environ.get("LLM_PROVIDER", ""),
    }


def _require_token_configured() -> str:
    token = os.environ.get(TOKEN_ENV, "")
    if not token or len(token) < 16:
        # Fail closed: a missing/weak operator token must stop the server, never
        # leave it open. Matches the crawler worker's no-token-no-boot guard.
        raise RuntimeError(
            f"{TOKEN_ENV} must be set to a strong (>=16 char) token before the "
            "graph worker can start."
        )
    return token


@asynccontextmanager
async def lifespan(_: FastAPI):
    _require_token_configured()
    # cognee stores live on the mounted volume; set once at boot.
    data_root = os.environ.get("COGNEE_DATA_ROOT", "/data/cognee/data")
    system_root = os.environ.get("COGNEE_SYSTEM_ROOT", "/data/cognee/system")
    cognee.config.data_root_directory(data_root)
    cognee.config.system_root_directory(system_root)
    # Capture the token usage of every LLM call cognee makes (see the usage
    # accounting block above). Registered once, lifespan runs once per process.
    litellm.callbacks.append(_UsageTracker())
    yield


app = FastAPI(title="Ciele Graph Knowledge worker", lifespan=lifespan)


async def require_auth(authorization: Optional[str] = Header(default=None)) -> None:
    """Bearer-token gate for every route except /health. Constant-time compare
    (`secrets.compare_digest`) so a wrong token leaks no length/prefix via
    timing; the token never appears in a response body or log line."""
    expected = _require_token_configured()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    provided = authorization[len("Bearer ") :]
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid bearer token")


async def _find_dataset(dataset: str):
    """Resolve a dataset by name for the worker's single (default) user, returning
    `(user, match_or_none)`. cognee keys datasets by UUID, not name; every route
    here addresses them by the Ciele dataset name, so this is the one name->record
    lookup they share."""
    from cognee.modules.data.methods import get_datasets
    from cognee.modules.users.methods import get_default_user

    user = await get_default_user()
    datasets = await get_datasets(user.id)
    match = next((d for d in datasets if d.name == dataset), None)
    return user, match


@asynccontextmanager
async def _dataset_context(dataset: str):
    """Open cognee's multi-tenant context for a dataset before any graph read,
    so reads never hit the silent empty-default-graph trap (spike finding)."""
    from cognee.context_global_variables import set_database_global_context_variables

    _, match = await _find_dataset(dataset)
    if match is None:
        raise HTTPException(status_code=404, detail="dataset not found")
    async with set_database_global_context_variables(match.id, match.owner_id):
        yield match


async def _dataset_graph(dataset: str):
    from cognee.infrastructure.databases.graph import get_graph_engine

    async with _dataset_context(dataset):
        engine = await get_graph_engine()
        return await engine.get_graph_data()


async def _delete_concept_docs(dataset: str, concept_id: str) -> int:
    """Delete every document in `dataset` tagged for `concept_id`. Used both by
    /remove and by /ingest (delete-then-add makes re-ingest a true replace
    rather than an append). Returns the number of documents removed.

    Scans the dataset's Data rows (O(rows) per call, fine for incremental
    single-Concept edits; the bulk backfill path in the ingestion fan-out (#387)
    batches instead of calling this per document)."""
    from cognee.modules.data.methods import get_dataset_data

    tag = f"{CONCEPT_TAG}{concept_id}"
    removed = 0
    async with _dataset_context(dataset) as match:
        rows = await get_dataset_data(match.id)
        for row in rows:
            node_set = row.node_set or []
            if isinstance(node_set, list) and tag in node_set:
                await cognee.delete(data_id=row.id, dataset_id=match.id, mode="hard")
                removed += 1
    return removed


# ---- request models ---------------------------------------------------------


class IngestDocument(BaseModel):
    concept_id: str
    source_id: Optional[str] = None
    text: str


class IngestRequest(BaseModel):
    dataset: str
    collection_id: str
    documents: list[IngestDocument]


class RemoveRequest(BaseModel):
    dataset: str
    concept_id: str


class PurgeRequest(BaseModel):
    dataset: str


class SearchRequest(BaseModel):
    dataset: str
    query: str
    mode: str = "graph_completion"
    session_id: Optional[str] = None
    top_k: int = 6


class FeedbackRequest(BaseModel):
    dataset: str
    session_id: str
    qa_id: str
    score: int = Field(ge=1, le=5)
    text: Optional[str] = None


class ImproveRequest(BaseModel):
    dataset: str
    session_ids: Optional[list[str]] = None
    distill: bool = False


# ---- routes -----------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ingest", dependencies=[Depends(require_auth)])
async def ingest(req: IngestRequest) -> dict[str, Any]:
    """add + cognify each Concept into the dataset, tagged so search can resolve
    provenance. Re-ingesting a conceptId replaces its prior document (delete the
    old tagged document first, so a re-ingest never appends a duplicate).
    `usage` reports the tokens the cognify LLM pass consumed."""
    with _collect_llm_usage() as llm_calls:
        ingested = 0
        for doc in req.documents:
            # Only attempt a replace-delete once the dataset exists (first ingest
            # into a brand-new collection has nothing to remove).
            try:
                await _delete_concept_docs(req.dataset, doc.concept_id)
            except HTTPException:
                pass  # dataset not created yet, nothing to replace
            node_set = [f"{CONCEPT_TAG}{doc.concept_id}"]
            if doc.source_id:
                node_set.append(f"{SOURCE_TAG}{doc.source_id}")
            await cognee.add(
                doc.text,
                dataset_name=req.dataset,
                node_set=node_set,
            )
            ingested += 1
        if ingested:
            await cognee.cognify([req.dataset])
    return {"ingested": ingested, "usage": _usage_summary(llm_calls)}


@app.post("/remove", dependencies=[Depends(require_auth)])
async def remove(req: RemoveRequest) -> dict[str, Any]:
    """Delete a Concept's document(s) from the dataset graph (on Concept delete).
    Best-effort: a missing dataset or document is a no-op, not an error."""
    try:
        removed = await _delete_concept_docs(req.dataset, req.concept_id)
    except HTTPException:
        return {"removed": 0}  # dataset not found, nothing to remove
    return {"removed": removed}


@app.post("/purge", dependencies=[Depends(require_auth)])
async def purge(req: PurgeRequest) -> dict[str, Any]:
    """Drop a whole dataset (on Knowledge Collection or Assistant delete): its
    graph, its vector store, and its dataset record, in one call. Reclaims the
    disk of a collection that will never be queried again, without fanning out a
    per-Concept remove. Best-effort, a dataset that was never created is a no-op
    (`purged: false`), matching /remove."""
    user, match = await _find_dataset(req.dataset)
    if match is None:
        return {"purged": False}  # never created, nothing to reclaim
    # empty_dataset opens the dataset's own multi-tenant context and removes its
    # graph + vector data and the dataset record; it addresses cognee by UUID.
    await cognee.datasets.empty_dataset(match.id, user)
    return {"purged": True}


def _provenance_from_references(references: Any) -> list[dict[str, Any]]:
    """Map cognee search references to Concept -> Source provenance using the
    node-set tags attached at ingest. Defensive against payload drift (spike):
    references may be dicts with `node_set`, `metadata`, or nested `payload`."""
    out: list[dict[str, Any]] = []
    for ref in references or []:
        if not isinstance(ref, dict):
            continue
        tags: list[str] = []
        for key in ("node_set", "belongs_to_set", "tags"):
            value = ref.get(key)
            if isinstance(value, list):
                tags.extend(str(t) for t in value)
            elif isinstance(value, str):
                tags.append(value)
        concept_id = next(
            (t[len(CONCEPT_TAG) :] for t in tags if t.startswith(CONCEPT_TAG)), None
        )
        source_id = next(
            (t[len(SOURCE_TAG) :] for t in tags if t.startswith(SOURCE_TAG)), None
        )
        excerpt = ref.get("text") or ref.get("excerpt") or ref.get("content") or ""
        out.append(
            {"concept_id": concept_id, "source_id": source_id, "excerpt": str(excerpt)}
        )
    return out


@app.post("/search", dependencies=[Depends(require_auth)])
async def search(req: SearchRequest) -> dict[str, Any]:
    """Search a dataset's graph. Passing session_id records a Retrieval Trace so
    the answer's graph elements can later be re-weighted by feedback. `usage`
    reports the tokens the graph-completion / session-guidance LLM calls
    consumed (zero calls for a pure CHUNKS retrieval)."""
    search_type = (
        SearchType.GRAPH_COMPLETION if req.mode == "graph_completion" else SearchType.CHUNKS
    )
    with _collect_llm_usage() as llm_calls:
        results = await cognee.search(
            query_text=req.query,
            query_type=search_type,
            datasets=[req.dataset],
            session_id=req.session_id,
            top_k=req.top_k,
            include_references=True,
        )
    # cognee returns a list of SearchResult; take the first (single-dataset).
    first = results[0] if isinstance(results, list) and results else results
    payload = first if isinstance(first, dict) else {}
    search_result = payload.get("search_result") or payload.get("result") or []
    answer = ""
    if isinstance(search_result, list) and search_result:
        answer = str(search_result[0])
    elif isinstance(search_result, str):
        answer = search_result
    references = payload.get("references") or payload.get("context") or []
    return {
        "answer": answer,
        "qa_id": payload.get("qa_id") or payload.get("session_qa_id"),
        "provenance": _provenance_from_references(references),
        "usage": _usage_summary(llm_calls),
    }


@app.post("/feedback", dependencies=[Depends(require_auth)])
async def feedback(req: FeedbackRequest) -> dict[str, Any]:
    """Record a 1-5 score (and optional Improvement text) on a graph answer.
    The weight update itself is applied later by /improve."""
    ok = await add_feedback(
        session_id=req.session_id,
        qa_id=req.qa_id,
        feedback_text=req.text,
        feedback_score=req.score,
    )
    return {"recorded": bool(ok)}


@app.post("/improve", dependencies=[Depends(require_auth)])
async def improve(req: ImproveRequest) -> dict[str, Any]:
    """Apply feedback weights (zero-LLM, always). When distill=false we run only
    the weight pass directly; distill=true runs cognee's full improve (LLM
    distillation), which the caller gates against the org's token budget.

    Distillation needs sessions to distill from, distill=true with no
    session_ids has nothing to distill, so it falls through to the weight pass
    (the same elements are re-weighted; only the LLM lesson step is skipped)."""
    with _collect_llm_usage() as llm_calls:
        if req.distill and req.session_ids:
            await cognee.improve(req.dataset, session_ids=req.session_ids)
        else:
            from cognee.memify_pipelines.apply_feedback_weights import (
                apply_feedback_weights_pipeline,
            )
            from cognee.modules.users.methods import get_default_user

            user = await get_default_user()
            await apply_feedback_weights_pipeline(
                user=user,
                session_ids=req.session_ids or [],
                dataset=req.dataset,
                alpha=0.3,
                run_in_background=False,
            )

    # Report how many edges now carry a non-neutral feedback weight, split by
    # direction: boosted (weight above neutral) vs demoted (below). A weight of
    # None/0 is unset, not a demotion, so it counts as neither, keeping
    # weighted_elements identical to the pre-split total (boosted + demoted).
    _, edges = await _dataset_graph(req.dataset)
    boosted = 0
    demoted = 0
    for e in edges:
        if len(e) <= EDGE_PROPS_INDEX:
            continue
        weight = (e[EDGE_PROPS_INDEX] or {}).get("feedback_weight")
        if weight in (None, 0, NEUTRAL_FEEDBACK_WEIGHT):
            continue
        if weight > NEUTRAL_FEEDBACK_WEIGHT:
            boosted += 1
        else:
            demoted += 1
    return {
        "weighted_elements": boosted + demoted,
        "boosted": boosted,
        "demoted": demoted,
        "usage": _usage_summary(llm_calls),
    }
