# v59 Chrome output clipping fix

- Keeps Entry List, Stage Results and Overall fully inside the browser output viewport.
- Prevents the Chrome-only responsive breakpoint from enlarging and shifting the graphic.
- Uses fixed, shared title/header/row/footer geometry for all 10-row table graphics.
- Keeps Stage Times inside the visible canvas as well.
- No data, parser, pagination, controller, Champs, broadcast or event logic changed.
