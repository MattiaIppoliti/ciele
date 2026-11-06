//! `ciele_identity`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn identity(api: &Api<'_>) -> Out {
    let meta = api.request(ApiRequest::get("/meta")).await?;
    let whoami = api.request(ApiRequest::get("/whoami")).await?;
    Ok(Some(obj(vec![("meta", meta), ("whoami", whoami)])))
}
