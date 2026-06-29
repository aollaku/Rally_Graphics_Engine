Cut render fix

This build fixes CUT actions at the output renderer level.

Changes:
- CUT Preview clears the controller preview monitor and HTTP /preview.
- CUT Output clears HTTP /output.
- CUT Both clears both Preview and Output.
- Logo, Bug Text and Clock now each have Preview / Output / Both cut controls.
- Overall Leaderboard, Stage Results, Stage Times and Entry List cut controls force the output renderer to clear the visible DOM, not only update saved state.
- Overlay layer cuts no longer depend on re-rendering the full graphic.
