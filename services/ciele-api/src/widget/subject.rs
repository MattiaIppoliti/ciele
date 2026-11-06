//! Who a widget request speaks for, and which Conversations are theirs
//! (`widgetSubject` and `subjectOwnsConversation` in `apps/web/src/lib/widget-db.ts`).

use axum::http::HeaderMap;
use serde_json::Value;
use sqlx::{PgPool, Row};

use super::gate::{SealKeys, gate_for_org};
use super::now_ms;

/// `conversations.subject_type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubjectKind {
    Sso,
    Visitor,
}

impl SubjectKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sso => "sso",
            Self::Visitor => "visitor",
        }
    }
}

/// The id a request claims, as the TypeScript route holds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SubjectId {
    /// A string. Empty is JavaScript's falsy id: the route answers 400.
    Text(String),
    /// A `visitorId` the body sent as a truthy non-string (`7`, `true`, `{}`).
    /// JavaScript keeps it, so the route does not answer 400, and no
    /// Conversation row can carry it, so it owns nothing.
    Unmatchable,
}

impl SubjectId {
    /// What the route's `!subject.id` refuses with 400.
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Text(id) if id.is_empty())
    }

    /// The id to compare with or bind against a row; `None` matches no row.
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text(id) => Some(id),
            Self::Unmatchable => None,
        }
    }
}

pub struct Subject {
    pub kind: SubjectKind,
    pub id: SubjectId,
}

/// A valid gate for the Organization wins over whatever the request claims.
pub fn widget_subject(
    headers: &HeaderMap,
    keys: &SealKeys,
    organization_id: &str,
    visitor_id: SubjectId,
) -> Subject {
    match gate_for_org(headers, keys, organization_id, now_ms()) {
        Some(gate) => Subject {
            kind: SubjectKind::Sso,
            id: SubjectId::Text(gate.subject_id),
        },
        None => Subject {
            kind: SubjectKind::Visitor,
            id: visitor_id,
        },
    }
}

/// `body.visitorId ?? ""` as the id it becomes.
pub fn body_visitor_id(body: &Value) -> SubjectId {
    match body.get("visitorId") {
        None | Some(Value::Null) => SubjectId::Text(String::new()),
        Some(Value::String(id)) => SubjectId::Text(id.clone()),
        Some(other) if super::truthy(Some(other)) => SubjectId::Unmatchable,
        Some(_) => SubjectId::Text(String::new()),
    }
}

/// The owner columns of one Conversation.
pub struct Owner {
    pub assistant_id: Option<String>,
    pub subject_type: String,
    pub subject_id: String,
}

impl Owner {
    /// `subjectOwnsConversation`: this Assistant's, and this exact subject's.
    pub fn is(&self, assistant_id: &str, subject: &Subject) -> bool {
        self.assistant_id.as_deref() == Some(assistant_id)
            && self.subject_type == subject.kind.as_str()
            && subject
                .id
                .as_text()
                .is_some_and(|id| !id.is_empty() && id == self.subject_id)
    }
}

fn owner(row: &sqlx::postgres::PgRow) -> Result<Owner, sqlx::Error> {
    Ok(Owner {
        assistant_id: row.try_get("assistant_id")?,
        subject_type: row.try_get("subject_type")?,
        subject_id: row.try_get("subject_id")?,
    })
}

pub async fn conversation_owner(pool: &PgPool, id: &str) -> Result<Option<Owner>, sqlx::Error> {
    sqlx::query(
        "select assistant_id, subject_type, subject_id from public.conversations where id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .as_ref()
    .map(owner)
    .transpose()
}

/// `getConversationForMessage`, the owner columns only.
pub async fn message_owner(pool: &PgPool, message_id: &str) -> Result<Option<Owner>, sqlx::Error> {
    sqlx::query(
        "select c.assistant_id, c.subject_type, c.subject_id \
         from public.messages m join public.conversations c on c.id = m.conversation_id \
         where m.id = $1",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?
    .as_ref()
    .map(owner)
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn owner(assistant: Option<&str>, kind: &str, id: &str) -> Owner {
        Owner {
            assistant_id: assistant.map(str::to_owned),
            subject_type: kind.into(),
            subject_id: id.into(),
        }
    }

    fn visitor(id: &str) -> Subject {
        Subject {
            kind: SubjectKind::Visitor,
            id: SubjectId::Text(id.into()),
        }
    }

    #[test]
    fn owns_only_its_own_assistant_and_subject() {
        let conversation = owner(Some("as-1"), "visitor", "v-1");
        assert!(conversation.is("as-1", &visitor("v-1")));
        assert!(!conversation.is("as-2", &visitor("v-1")));
        assert!(!conversation.is("as-1", &visitor("v-2")));
        let sso = Subject {
            kind: SubjectKind::Sso,
            id: SubjectId::Text("v-1".into()),
        };
        assert!(!conversation.is("as-1", &sso));
        let unmatchable = Subject {
            kind: SubjectKind::Visitor,
            id: SubjectId::Unmatchable,
        };
        assert!(!unmatchable.id.is_missing());
        assert!(!conversation.is("as-1", &unmatchable));
        assert!(!owner(Some("as-1"), "visitor", "").is("as-1", &visitor("")));
        assert!(!owner(None, "visitor", "v-1").is("as-1", &visitor("v-1")));
    }

    #[test]
    fn reads_the_visitor_id_as_javascript_does() {
        let text = |id: &str| SubjectId::Text(id.into());
        assert_eq!(body_visitor_id(&json!({ "visitorId": "v-1" })), text("v-1"));
        assert_eq!(body_visitor_id(&json!({})), text(""));
        assert_eq!(body_visitor_id(&json!({ "visitorId": 0 })), text(""));
        assert_eq!(
            body_visitor_id(&json!({ "visitorId": 7 })),
            SubjectId::Unmatchable
        );
    }
}
