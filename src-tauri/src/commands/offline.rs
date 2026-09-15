use crate::offline::{
    OfflineChapter, OfflineChapterContent, OfflineControlRequest, OfflineEnqueueRequest,
    OfflineStats, OfflineStore, OfflineSupplyRequest,
};
use crate::task_queue::{TaskQueue, TaskStatus};
use serde_json::json;
use tauri::State;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineEnqueueResult {
    pub chapters: Vec<OfflineChapter>,
}

#[tauri::command]
pub fn offline_enqueue(
    store: State<'_, OfflineStore>,
    queue: State<'_, TaskQueue>,
    request: OfflineEnqueueRequest,
) -> Result<OfflineEnqueueResult, String> {
    let chapters = store.enqueue(request)?;
    let mut attached = Vec::with_capacity(chapters.len());
    for chapter in chapters {
        let task = queue.enqueue_with_metadata(
            chapter.title.clone(),
            "download".into(),
            Some(format!("offline:{}", chapter.offline_chapter_key)),
            json!({
                "offlineBundleId": chapter.offline_bundle_id,
                "offlineChapterKey": chapter.offline_chapter_key,
                "resourceKey": chapter.resources.iter().map(|r| r.resource_key.clone()).collect::<Vec<_>>(),
                "savePath": chapter.save_path,
                "url": null,
                "offline": true
            }),
        )?;
        attached.push(store.attach_task(&chapter.offline_chapter_key, task.id)?);
    }
    Ok(OfflineEnqueueResult { chapters: attached })
}

#[tauri::command]
pub fn offline_supply_chapter(
    store: State<'_, OfflineStore>,
    queue: State<'_, TaskQueue>,
    request: OfflineSupplyRequest,
) -> Result<OfflineChapter, String> {
    let chapter = store.supply(request)?;
    if let Some(task_id) = chapter.task_id.as_deref() {
        if chapter.readable {
            let _ = queue.update(
                task_id,
                Some(TaskStatus::Running),
                None,
                Some("正在提交离线章节".into()),
            );
            let _ = queue.update(
                task_id,
                Some(TaskStatus::Succeeded),
                Some(1.0),
                Some("离线章节已完成".into()),
            );
        } else {
            let _ = queue.update(
                task_id,
                Some(TaskStatus::Running),
                None,
                Some("正在写入离线章节".into()),
            );
        }
    }
    Ok(chapter)
}

#[tauri::command]
pub fn offline_list(store: State<'_, OfflineStore>) -> Result<Vec<OfflineChapter>, String> {
    store.list()
}

#[tauri::command]
pub fn offline_get_chapter(
    store: State<'_, OfflineStore>,
    chapter_key: String,
) -> Result<OfflineChapterContent, String> {
    store.get_chapter(&chapter_key)
}

#[tauri::command]
pub fn offline_control(
    store: State<'_, OfflineStore>,
    queue: State<'_, TaskQueue>,
    request: OfflineControlRequest,
) -> Result<OfflineChapter, String> {
    let current = store
        .list()?
        .into_iter()
        .find(|c| c.offline_chapter_key == request.chapter_key)
        .ok_or_else(|| "离线章节不存在".to_string())?;
    let action = request.action.trim().to_ascii_lowercase();
    let chapter = store.control(request)?;
    if let Some(task_id) = current.task_id.as_deref() {
        match action.as_str() {
            "pause" => {
                let _ = queue.update(
                    task_id,
                    Some(TaskStatus::Paused),
                    None,
                    Some("离线任务已暂停".into()),
                );
            }
            "resume" | "retry" => {
                let _ = queue.update(
                    task_id,
                    Some(TaskStatus::Queued),
                    None,
                    Some("离线任务已重新排队".into()),
                );
            }
            "cancel" => {
                let _ = queue.cancel(task_id);
            }
            "delete" => {
                let _ = queue.cancel(task_id);
                let _ = queue.remove(task_id);
            }
            _ => {}
        }
    }
    Ok(chapter)
}

#[tauri::command]
pub fn offline_stats(store: State<'_, OfflineStore>) -> Result<OfflineStats, String> {
    store.stats()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_names_and_request_shape_are_stable() {
        let value = serde_json::to_value(OfflineControlRequest {
            chapter_key: "chapter".into(),
            action: "pause".into(),
        })
        .unwrap();
        assert_eq!(value["chapterKey"], "chapter");
        assert_eq!(value["action"], "pause");
    }
}
