use crate::store::{Category, NewCategory, UpdateCategory, new_id};
use super::connections::{load_store, save_store};

#[tauri::command]
pub async fn list_categories(app: tauri::AppHandle) -> std::result::Result<Vec<Category>, String> {
    load_store(&app)
        .map(|s| s.categories)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_category(app: tauri::AppHandle, category: NewCategory) -> std::result::Result<Category, String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    let cat = Category {
        id: new_id(),
        name: category.name,
    };
    store.categories.push(cat.clone());
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(cat)
}

#[tauri::command]
pub async fn update_category(app: tauri::AppHandle, category: UpdateCategory) -> std::result::Result<Category, String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    let cat = store.categories.iter_mut()
        .find(|c| c.id == category.id)
        .ok_or("Category not found")?;
    cat.name = category.name;
    let updated = cat.clone();
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub async fn delete_category(app: tauri::AppHandle, id: String) -> std::result::Result<(), String> {
    let mut store = load_store(&app).map_err(|e| e.to_string())?;
    store.categories.retain(|c| c.id != id);
    for group in store.groups.iter_mut() {
        if group.category_id.as_deref() == Some(&id) {
            group.category_id = None;
        }
    }
    save_store(&app, &store).map_err(|e| e.to_string())?;
    Ok(())
}
