# V11 Logo blink fix

Fixed the 1-second logo blinking on Preview/Output by stopping the output page from rebuilding the logo image DOM every second.

Changes:
- Logo image element is now kept alive between scene refreshes.
- Logo PNG is only reloaded when the selected logo URL changes.
- Alpha edge repair no longer causes a repeated reload loop.
- Clock can still update every second without disturbing the logo.
