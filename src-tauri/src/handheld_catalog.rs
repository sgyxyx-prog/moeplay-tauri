//! Personal handheld albums and confirmed work bindings.

use crate::db::Database;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

pub const CATALOG_KEY: &str = "handheld_catalog_v1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlbumMember {
    pub id: String,
    pub content_id: Option<String>,
    pub bangumi_id: Option<i64>,
    pub kind: String,
    pub title: String,
    pub cover: Option<String>,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub relation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionAlbum {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub cover: Option<String>,
    #[serde(default = "center_focal")]
    pub focal_x: f32,
    #[serde(default = "center_focal")]
    pub focal_y: f32,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub members: Vec<AlbumMember>,
    #[serde(default)]
    pub ignored_subjects: Vec<i64>,
    pub updated_at: i64,
}

fn center_focal() -> f32 {
    0.5
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkBinding {
    pub content_id: String,
    pub bangumi_id: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDocument {
    pub schema_version: u32,
    pub revision: u64,
    #[serde(default)]
    pub albums: Vec<CollectionAlbum>,
    #[serde(default)]
    pub bindings: Vec<WorkBinding>,
}

impl Default for CatalogDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            albums: Vec::new(),
            bindings: Vec::new(),
        }
    }
}

impl CatalogDocument {
    pub fn from_json(value: &str) -> Result<Self, String> {
        let document: Self =
            serde_json::from_str(value).map_err(|e| format!("专题数据解析失败: {e}"))?;
        document.validate()?;
        Ok(document)
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!("不支持专题数据版本 {}", self.schema_version));
        }
        if self.albums.len() > 1000 || self.bindings.len() > 100_000 {
            return Err("专题数据超过容量限制".into());
        }
        let mut ids = std::collections::HashSet::new();
        for album in &self.albums {
            if album.id.trim().is_empty()
                || album.title.trim().is_empty()
                || album.title.len() > 240
                || !ids.insert(&album.id)
            {
                return Err("专题 ID 或名称无效".into());
            }
            if !album.focal_x.is_finite()
                || !album.focal_y.is_finite()
                || !(0.0..=1.0).contains(&album.focal_x)
                || !(0.0..=1.0).contains(&album.focal_y)
            {
                return Err("专题封面位置无效".into());
            }
            if album.members.len() > 10_000 {
                return Err("专题条目超过容量限制".into());
            }
            let mut member_ids = std::collections::HashSet::new();
            for member in &album.members {
                if member.id.trim().is_empty()
                    || member.title.trim().is_empty()
                    || !member_ids.insert(&member.id)
                    || !matches!(
                        member.kind.as_str(),
                        "game" | "anime" | "comic" | "novel" | "book"
                    )
                    || member.bangumi_id.is_some_and(|id| id <= 0)
                {
                    return Err("专题作品条目无效".into());
                }
            }
        }
        let mut binding_ids = std::collections::HashSet::new();
        if self.bindings.iter().any(|binding| {
            binding.content_id.trim().is_empty()
                || binding.bangumi_id <= 0
                || !binding_ids.insert(&binding.content_id)
        }) {
            return Err("作品绑定无效".into());
        }
        Ok(())
    }
}

#[tauri::command]
pub fn handheld_catalog_get(db: State<'_, Database>) -> Result<CatalogDocument, String> {
    db.sqlite()
        .get_setting(CATALOG_KEY)?
        .map(|value| CatalogDocument::from_json(&value))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

#[tauri::command]
pub fn handheld_catalog_save(
    db: State<'_, Database>,
    mut catalog: CatalogDocument,
) -> Result<CatalogDocument, String> {
    catalog.validate()?;
    db.sqlite().with_connection_mut(|conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let stored: Option<String> = tx.query_row("SELECT value_json FROM settings WHERE key=?1", params![CATALOG_KEY], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        let current = stored.map(|value| CatalogDocument::from_json(&value)).transpose()?.unwrap_or_default();
        if catalog.revision != current.revision { return Err("专题数据已在其他窗口修改，请刷新后重试".into()); }
        catalog.revision += 1;
        let value = serde_json::to_string(&catalog).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO settings(key,value_json) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", params![CATALOG_KEY, value]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(catalog)
    })
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkRelation {
    pub subject_id: i64,
    pub title: String,
    pub relation: String,
    pub subject_type: i64,
    pub cover: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkCandidate {
    pub subject_id: i64,
    pub title: String,
    pub subject_type: i64,
    pub cover: Option<String>,
}

#[tauri::command]
pub async fn handheld_bangumi_search(keyword: String) -> Result<Vec<WorkCandidate>, String> {
    let keyword = keyword.trim();
    if keyword.is_empty() || keyword.chars().count() > 120 {
        return Err("搜索词长度无效".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(format!(
            "MoePlay/{} (+https://github.com/sgyxyx-prog/moeplay-tauri)",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post("https://api.bgm.tv/v0/search/subjects?limit=20")
        .header("Accept", "application/json")
        .json(&serde_json::json!({"keyword": keyword, "filter": {"type": [1,2,4]}}))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(data
        .get("data")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let subject_id = row.get("id")?.as_i64()?;
            let title = row
                .get("name_cn")
                .and_then(|x| x.as_str())
                .filter(|x| !x.trim().is_empty())
                .or_else(|| row.get("name").and_then(|x| x.as_str()))?
                .to_string();
            Some(WorkCandidate {
                subject_id,
                title,
                subject_type: row.get("type").and_then(|x| x.as_i64()).unwrap_or(0),
                cover: row
                    .get("images")
                    .and_then(|x| x.get("large"))
                    .and_then(|x| x.as_str())
                    .map(str::to_string),
            })
        })
        .collect())
}

fn parse_relations(value: &serde_json::Value, original_id: i64) -> Vec<WorkRelation> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let subject = row.get("subject").unwrap_or(row);
            let subject_id = subject.get("id")?.as_i64()?;
            if subject_id <= 0 || subject_id == original_id {
                return None;
            }
            let title = subject
                .get("name_cn")
                .and_then(|x| x.as_str())
                .filter(|x| !x.trim().is_empty())
                .or_else(|| subject.get("name").and_then(|x| x.as_str()))?
                .trim()
                .to_string();
            if title.is_empty() {
                return None;
            }
            Some(WorkRelation {
                subject_id,
                title,
                relation: row
                    .get("relation")
                    .and_then(|x| x.as_str())
                    .unwrap_or("相关作品")
                    .to_string(),
                subject_type: subject.get("type").and_then(|x| x.as_i64()).unwrap_or(0),
                cover: subject
                    .get("images")
                    .and_then(|x| x.get("large"))
                    .and_then(|x| x.as_str())
                    .map(str::to_string),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn handheld_bangumi_relations(subject_id: i64) -> Result<Vec<WorkRelation>, String> {
    if subject_id <= 0 {
        return Err("条目 ID 无效".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(format!(
            "MoePlay/{} (+https://github.com/sgyxyx-prog/moeplay-tauri)",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.bgm.tv/v0/subjects/{subject_id}/subjects");
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(parse_relations(&data, subject_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relation_parser_keeps_identity_and_type() {
        let value = serde_json::json!([{"relation":"改编", "subject":{"id":42,"name":"Original","name_cn":"原作","type":1,"images":{"large":"https://example.test/cover.jpg"}}}, {"relation":"自身", "subject":{"id":5,"name":"Same","type":2}}]);
        assert_eq!(
            parse_relations(&value, 5),
            vec![WorkRelation {
                subject_id: 42,
                title: "原作".into(),
                relation: "改编".into(),
                subject_type: 1,
                cover: Some("https://example.test/cover.jpg".into())
            }]
        );
        let official_shape = serde_json::json!([{"id":43,"name":"Next","name_cn":"续作","type":2,"relation":"续集","images":{"large":"https://example.test/next.jpg"}}]);
        assert_eq!(parse_relations(&official_shape, 5)[0].subject_id, 43);
    }

    #[test]
    fn catalog_rejects_duplicate_members_and_future_schema() {
        let mut doc = CatalogDocument::default();
        doc.schema_version = 2;
        assert!(doc.validate().is_err());
        doc.schema_version = 1;
        doc.albums.push(CollectionAlbum {
            id: "a".into(),
            title: "测试".into(),
            description: String::new(),
            cover: None,
            focal_x: 0.5,
            focal_y: 0.5,
            pinned: false,
            members: vec![
                AlbumMember {
                    id: "game:1".into(),
                    content_id: Some("game:1".into()),
                    bangumi_id: None,
                    kind: "game".into(),
                    title: "游戏".into(),
                    cover: None,
                    group: String::new(),
                    note: String::new(),
                    relation: String::new()
                };
                2
            ],
            ignored_subjects: Vec::new(),
            updated_at: 0,
        });
        assert!(doc.validate().is_err());
    }

    #[tokio::test]
    #[ignore = "requires the live Bangumi service"]
    async fn live_bangumi_search_and_relations() {
        let found = handheld_bangumi_search("命运石之门".into()).await.unwrap();
        assert!(!found.is_empty());
        let related = handheld_bangumi_relations(2585).await.unwrap();
        assert!(!related.is_empty());
    }
}
