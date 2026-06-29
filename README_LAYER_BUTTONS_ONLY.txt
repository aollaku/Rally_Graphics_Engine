Layer Button Workflow Update
============================

Bug Text, Logo and Clock are now controlled only from the main Graphics Output button area.

New workflow:
- Press Bug Text once: shows Bug Text on Preview only.
- Press Bug Text again: sends Bug Text to Live Output.
- Press Logo once: shows Logo on Preview only.
- Press Logo again: sends Logo to Live Output.
- Press Clock once: shows Clock on Preview only.
- Press Clock again: sends Clock to Live Output.

Removed/changed logic:
- Bug, Logo and Clock visibility checkboxes no longer control output visibility.
- Graphics Settings / Designer only controls styling, position, size, text and selected logo.
- Old saved values like bug.enabled, logoEnabled and clock.enabled no longer auto-show these layers.
- /preview and /output each use their own layer visibility state.

This prevents Logo/Bug/Clock from appearing automatically after reload, clear, config import, or settings refresh.
