# Rally Graphics v37 - Stage Times Two-Line Title

This build keeps the same controller, tablet, output routing and graphics layout as v36.

Only change:
- Stage Times title is split into two lines:
  - `TIMES FOR STAGE X :`
  - `STAGE NAME`

Controller remains HTTPS only and output remains HTTP only:
- Controller: https://localhost:8443/controller
- Tablet: https://localhost:8443/tablet
- Output: http://localhost:8080/output/live

Run:
```bash
docker compose down -v --remove-orphans
docker compose up -d --build
```

## Graphics Settings sub-tab

This build includes the live graphics designer inside the desktop controller.

Open the controller and use **Graphics Settings** in the left menu, or scroll to the Graphics Settings card under Graphics Output.

Controls added:

- Resize / scale
- X and Y position
- Output width and height
- Master opacity
- Background opacity
- Border opacity
- Shadow opacity
- Blur
- Brightness and contrast
- Corner radius
- Animation speed
- Animation duration
- Easing
- 1080p, 720p and reset presets

Settings are saved in the shared app state and are applied live to both preview and programme output.


## v38 graphics settings flicker fix

The graphics settings panel is integrated in the controller. Animation speed/easing changes now update live without restarting the on-air graphic, preventing the one-frame flicker seen when changing ease-in/ease-out. The intro animation still plays when a new graphic is taken.
