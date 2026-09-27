// Tab helpers built on the chrome.* extension APIs. The extension edition calls them
// directly; the local edition runs them in the side panel extension's bridge page,
// serialized with toString(), so each function must be self-contained.

// Opens a tab right after the opener tab, in its window (or in fallbackWindowId, else the
// last focused normal window, when there is no opener), and returns the new tab's id.
export async function openTabNear(openerTabId, url, fallbackWindowId) {
  const opener = openerTabId !== null && openerTabId !== undefined ? await chrome.tabs.get(openerTabId).catch(() => null) : null;
  let windowId = opener?.windowId ?? fallbackWindowId;
  if (windowId === undefined) {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
    windowId = win?.id;
  }
  const tab = await chrome.tabs.create({
    url: url || "about:blank",
    active: true,
    ...(windowId !== undefined && { windowId }),
    ...(opener && { index: opener.index + 1, openerTabId: opener.id }),
  });
  return tab.id;
}

// Keeps the tab the agent is working in inside a group titled "Agent". The group
// follows the agent: the previous tab is ungrouped in place and the new one grouped.
// Tabs already in a group of the user's are left alone. A null tab id removes it. Each
// owner (an agent) has its own group, so agents in different windows do not collide.
export async function moveAgentGroup(tabId, owner = "agent") {
  const stateKey = `agentGroup:${owner}`;
  const { [stateKey]: agentGroup } = await chrome.storage.session.get(stateKey);
  const tab = tabId !== null && tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (agentGroup && (!tab || tab.groupId !== agentGroup.groupId)) {
    const members = await chrome.tabs.query({ groupId: agentGroup.groupId }).catch(() => []);
    if (members.length) await chrome.tabs.ungroup(members.map((t) => t.id)).catch(() => {});
    await chrome.storage.session.remove(stateKey);
  }
  if (!tab) return null;
  if (tab.groupId === agentGroup?.groupId) return tab.groupId;
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
  const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(groupId, { title: "Agent", color: "blue", collapsed: false });
  await chrome.storage.session.set({ [stateKey]: { groupId } });
  return groupId;
}
