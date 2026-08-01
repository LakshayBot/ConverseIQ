// AppState used to wrap a `DatabaseManager` for the SQLite layer that the
// desktop used to keep locally. That layer is gone - the desktop now
// talks to the .NET Gateway for every operation - so AppState is now an
// empty marker struct kept around for future server-side state (HTTP
// client pools, shared caches, etc.) without forcing every Tauri command
// signature to change.
pub struct AppState {}