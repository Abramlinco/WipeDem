# FAQ approval retrieval fix

The approved FAQ source title retains the original question for search and traceability. The indexed source text begins with the manager-approved answer, followed by the verification note.

The integration test explicitly requests a fresh draft after approval (`fresh: true`). Without that flag, the API may return an automatically cached draft created before the FAQ was approved, which cannot prove that the newly approved knowledge is being retrieved.

Run:
```powershell
npm install
$env:AI_PROVIDER = 'none'
npm test
Remove-Item Env:AI_PROVIDER
```
