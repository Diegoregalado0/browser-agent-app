// Opens the side panel when the toolbar icon (or its shortcut) is used.
chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
chrome.runtime.onStartup.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
