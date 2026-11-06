//! `manage_knowledge`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn knowledge(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let links = |ids: &[String]| Some(Value::from(ids.to_vec()));
    match action {
        "search" => {
            let body = obj(vec![
                ("query", Some(need(args, "query")?.into())),
                ("assistantId", opt_truthy(args, "assistantId")),
            ]);
            api.request(ApiRequest::post("/knowledge/search").json(body))
                .await
        }
        "list_collections" => {
            let assistant = need(args, "assistantId")?;
            api.request(ApiRequest::get(format!(
                "/assistants/{}/collections",
                encode(&assistant)
            )))
            .await
        }
        "list_sources" => {
            let collection = need(args, "collectionId")?;
            api.request(ApiRequest::get(format!(
                "/collections/{}/sources",
                encode(&collection)
            )))
            .await
        }
        "get_source" => {
            let source = need(args, "sourceId")?;
            api.request(ApiRequest::get(format!("/sources/{}", encode(&source))))
                .await
        }
        "add_text" => {
            let collection = need(args, "collectionId")?;
            let name = opt(args, "name");
            let text = need(args, "text")?;
            let ids = need_link_targets(args)?;
            let body = obj(vec![
                ("kind", Some("text".into())),
                ("name", name),
                ("text", Some(text.into())),
                ("assistantIds", links(&ids)),
            ]);
            api.request(
                ApiRequest::post(format!("/collections/{}/sources", encode(&collection)))
                    .json(body),
            )
            .await
        }
        "add_url" => {
            let collection = need(args, "collectionId")?;
            let url = need(args, "url")?;
            let ids = need_link_targets(args)?;
            api.request(
                ApiRequest::post(format!("/collections/{}/sources", encode(&collection)))
                    .json(json!({ "kind": "url", "url": url, "assistantIds": ids })),
            )
            .await
        }
        "add_file" => {
            let (name, bytes) = upload(args)?;
            let collection = need(args, "collectionId")?;
            let ids = need_link_targets(args)?;
            api.request(
                ApiRequest::post(format!("/collections/{}/sources", encode(&collection)))
                    .form(linked_form(name, "application/octet-stream", bytes, &ids)),
            )
            .await
        }
        "add_org_text" => {
            let name = opt(args, "name");
            let text = need(args, "text")?;
            let ids = need_link_targets(args)?;
            let body = obj(vec![
                ("kind", Some("text".into())),
                ("name", name),
                ("text", Some(text.into())),
                ("assistantIds", links(&ids)),
            ]);
            api.request(ApiRequest::post("/knowledge/sources").json(body))
                .await
        }
        "add_org_url" => {
            let url = need(args, "url")?;
            let ids = need_link_targets(args)?;
            api.request(
                ApiRequest::post("/knowledge/sources")
                    .json(json!({ "kind": "url", "url": url, "assistantIds": ids })),
            )
            .await
        }
        "add_org_file" => {
            let (name, bytes) = upload(args)?;
            let ids = need_link_targets(args)?;
            api.request(ApiRequest::post("/knowledge/sources").form(linked_form(
                name,
                "application/octet-stream",
                bytes,
                &ids,
            )))
            .await
        }
        "delete_source" => {
            let source = need(args, "sourceId")?;
            api.request(ApiRequest::delete(format!("/sources/{}", encode(&source))))
                .await?;
            echo("deleted", opt(args, "sourceId"))
        }
        "recrawl" => {
            let source = need(args, "sourceId")?;
            api.request(ApiRequest::post(format!(
                "/sources/{}/recrawl",
                encode(&source)
            )))
            .await
        }
        "add_faq" => {
            let collection = need(args, "collectionId")?;
            let body = json!({
                "question": need(args, "question")?,
                "answer": need(args, "answer")?,
                "assistantIds": need_link_targets(args)?,
            });
            api.request(
                ApiRequest::post(format!("/collections/{}/faqs", encode(&collection))).json(body),
            )
            .await
        }
        "import_faqs" => {
            let collection = need(args, "collectionId")?;
            let csv = need(args, "csvText")?;
            let ids = need_link_targets(args)?;
            api.request(
                ApiRequest::post(format!("/collections/{}/faqs/import", encode(&collection))).form(
                    linked_form("faqs.csv".into(), "text/csv", csv.into_bytes(), &ids),
                ),
            )
            .await
        }
        "list_org_sources" => {
            let qs = {
                let mut search = form_urlencoded::Serializer::new(String::new());
                if let Some(Value::Array(kinds)) = args.get("kinds")
                    && !kinds.is_empty()
                {
                    let joined: Vec<String> = kinds.iter().map(js_string).collect();
                    search.append_pair("kinds", &joined.join(","));
                }
                for key in ["status", "assistantId", "q"] {
                    if let Some(value) = args.get(key)
                        && is_truthy(value)
                    {
                        search.append_pair(key, &js_string(value));
                    }
                }
                search.finish()
            };
            let path = if qs.is_empty() {
                "/knowledge/sources".to_owned()
            } else {
                format!("/knowledge/sources?{qs}")
            };
            api.request(ApiRequest::get(path)).await
        }
        "set_links" => {
            let source = need(args, "sourceId")?;
            let ids = opt(args, "assistantIds").unwrap_or_else(|| json!([]));
            api.request(
                ApiRequest::put(format!("/sources/{}/links", encode(&source)))
                    .json(json!({ "assistantIds": ids })),
            )
            .await
        }
        "set_direct_access" => {
            let source = need(args, "sourceId")?;
            let assistant = need(args, "assistantId")?;
            let direct = args.get("directAccess") == Some(&Value::Bool(true));
            api.request(
                ApiRequest::put(format!("/sources/{}/direct-access", encode(&source)))
                    .json(json!({ "assistantId": assistant, "directAccess": direct })),
            )
            .await
        }
        "add_org_faq" => {
            let body = json!({
                "question": need(args, "question")?,
                "answer": need(args, "answer")?,
                "assistantIds": need_link_targets(args)?,
            });
            api.request(ApiRequest::post("/knowledge/faqs").json(body))
                .await
        }
        "import_org_faqs" => {
            let csv = need(args, "csvText")?;
            let ids = need_link_targets(args)?;
            api.request(ApiRequest::post("/knowledge/faqs/import").form(linked_form(
                "faqs.csv".into(),
                "text/csv",
                csv.into_bytes(),
                &ids,
            )))
            .await
        }
        "export_faqs" => {
            let csv = api.text(ApiRequest::get("/knowledge/faqs/export")).await?;
            Ok(Some(json!({ "csv": csv })))
        }
        "list_documents" => {
            let source = need(args, "sourceId")?;
            api.request(ApiRequest::get(format!(
                "/sources/{}/documents",
                encode(&source)
            )))
            .await
        }
        "review_document" => {
            let source = need(args, "sourceId")?;
            let document = need(args, "documentId")?;
            api.request(ApiRequest::post(format!(
                "/sources/{}/documents/{}/review",
                encode(&source),
                encode(&document)
            )))
            .await
        }
        "remove_review" => {
            let source = need(args, "sourceId")?;
            let document = need(args, "documentId")?;
            api.request(ApiRequest::delete(format!(
                "/sources/{}/documents/{}/review",
                encode(&source),
                encode(&document)
            )))
            .await?;
            Ok(Some(json!({ "removed": true })))
        }
        "get_faq" => {
            let source = need(args, "sourceId")?;
            api.request(ApiRequest::get(format!("/sources/{}/faq", encode(&source))))
                .await
        }
        "update_faq" => {
            let source = need(args, "sourceId")?;
            let body = obj(vec![
                ("question", Some(need(args, "question")?.into())),
                ("answer", Some(need(args, "answer")?.into())),
            ]);
            api.request(ApiRequest::patch(format!("/sources/{}/faq", encode(&source))).json(body))
                .await
        }
        "faq_history" => {
            let source = need(args, "sourceId")?;
            api.request(ApiRequest::get(format!(
                "/sources/{}/faq/history",
                encode(&source)
            )))
            .await
        }
        "restore_faq" => {
            let source = need(args, "sourceId")?;
            let version = need(args, "versionId")?;
            api.request(
                ApiRequest::post(format!("/sources/{}/faq/restore", encode(&source)))
                    .json(json!({ "versionId": version })),
            )
            .await
        }
        "check_faq_duplicates" => {
            let body = obj(vec![
                ("question", Some(need(args, "question")?.into())),
                ("collectionId", opt_truthy(args, "collectionId")),
            ]);
            api.request(ApiRequest::post("/knowledge/faqs/check").json(body))
                .await
        }
        "source_usage" => {
            let source = need(args, "sourceId")?;
            api.request(ApiRequest::get(format!(
                "/sources/{}/usage",
                encode(&source)
            )))
            .await
        }
        _ => Err(unknown_action(args)),
    }
}
