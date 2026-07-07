# V44 Settings Scope Dropdown Fix

Fixed the Graphics Settings Scope dropdown reverting immediately to Global Default.

Root cause: the change handler awaited a server save before storing the new selected scope. During that await, the websocket graphicsSettings refresh re-rendered the controls using the old scope, forcing the dropdown back to Global Default.

Fix: capture and persist the selected scope immediately, then render that scope. No graphics layout, data parsing, stage logic, entry list logic, logo logic, tablet controller, or broadcast engine code was changed.
