CONFIG USERS RESTORE FIX

Full Config export/import now includes users with password hashes.
This means if users are deleted, importing a previous Full Config will restore:
- usernames
- roles
- display names
- enabled/disabled state
- existing passwords via password_hash

Security note: exported config files now contain password hashes and must be kept private.
Use Import: Merge to restore missing users without clearing data.
Use Import: Replace Data to replace data and restore users from the file.
