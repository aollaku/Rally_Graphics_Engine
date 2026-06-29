V39 / flicker fix v3

This build changes the graphics output from one live DOM layer to two output layers:
- current graphic stays visible and stable
- next graphic renders on the inactive layer
- when data is ready, the inactive layer fades in above the old one
- old layer is cleared only after the transition is finished

This prevents the random one-frame blink that happened on some graphics/pages after the in animation.
