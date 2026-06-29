Layer visibility fix
====================

Fixed Bug/Sponsor and Logo visibility so they are persistent independent layers.

Changes:
- Clear Graphic / Clear Program no longer resets Bug, Logo, or Clock layer visibility.
- Bug/Sponsor text layer and Logo layer now have separate ON/OFF controls.
- Unticking Bug/Sponsor stays off after clearing graphics.
- Unticking Logo stays off after clearing graphics.
- Logo library selection remains saved but the logo is only displayed when Logo Layer is enabled.
- Scene layer saving now deep-merges layer settings instead of accidentally replacing/resetting nested layer properties.
