V2 flicker fix:
- Prevents stale async renders from writing an older graphic after a newer graphic was selected.
- Keeps the intro animation class after completion to avoid one-frame repaint flicker when CSS animation finishes.
- Existing controller layout swap is preserved.
