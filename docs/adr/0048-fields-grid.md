# 48. Fields as one inline grid

Status: accepted

## Decision
- The Fields tab edits label, type, length, group, required and the other options directly in the table rows; a details panel holds the rest. Removing a field is undoable until publish.
- Pack fields can be changed but their keys never are. The Draft records every choice; Live changes only on publish.
