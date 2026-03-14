# Employee Suggestions System (Google Forms → Google Sheets → Gemini AI)

A lightweight **employee suggestion collection and triage system** built on **Google Forms + Google Sheets + Google Apps Script**, with optional **Gemini AI** enrichment.

Employees submit suggestions via a Google Form. Responses land in a Google Sheet (tab: **Ham Veri**). An Apps Script (`script.gs`) periodically finds *only the newly added rows* and sends each suggestion to **Gemini** for structured analysis. Results are written back to the same spreadsheet (tab: **AI Analizi**) so HR/People Ops/Managers can filter, sort, and prioritize suggestions quickly.

---

## What this project does

- Collects employee suggestions through a **Google Form**
- Stores raw submissions in Google Sheets (**Ham Veri**)
- Automatically analyzes new suggestions with **Gemini** and generates:
  - category
  - urgency score
  - implementation difficulty
  - cost estimate
  - impacted people count
  - keywords
  - sentiment
  - priority score (1–100)
  - short summary
- Writes AI output into a second sheet (**AI Analizi**) aligned **row-by-row** with the source data
- Provides a custom spreadsheet menu (**🤖 AI Analizi**) to start/stop automation and run tests

---

## Repository contents

- `script.gs` — Google Apps Script that:
  - detects new rows in **Ham Veri**
  - calls Gemini (with retry/backoff handling)
  - parses the response JSON
  - writes results into **AI Analizi**
  - manages time-based triggers and adds a spreadsheet menu

---

## Architecture / Data flow

1. **Google Form** submission
2. Response is saved into Google Sheets → **Ham Veri**
3. Apps Script runs every 10 minutes (configurable):
   - compares last row in **Ham Veri** vs last row in **AI Analizi**
   - processes only the missing/new rows
4. Gemini returns a JSON analysis
5. Output is saved to Google Sheets → **AI Analizi**

> The system assumes that rows in **AI Analizi** correspond to the same row numbers as **Ham Veri**.

---

## Spreadsheet setup

Create a Google Spreadsheet with **two tabs** (sheet names must match exactly):

### 1) `Ham Veri` (Raw Data)

The script reads **6 columns** from each row (`getRange(i, 1, 1, 6)`).

The important columns used by the script are:

- **B (index 1)**: `departman`
- **C (index 2)**: `kategoriUser` (user-selected category)
- **D (index 3)**: `oneriMetni` (suggestion text) ← required (if empty, row is skipped)
- **E (index 4)**: `aciliyetUser` (urgency from user, expected 1–5)

> Column A and F exist but are not used by the AI prompt in the current script.

### 2) `AI Analizi` (AI Analysis)

The script writes **9 columns** of AI output into the same row number `i`:

1. `kategori`
2. `aciliyet_skoru`
3. `uygulama_zorlugu`
4. `maliyet_tahmini`
5. `etkilenen_kisi`
6. `anahtar_kelimeler` (comma-separated string)
7. `sentiment`
8. `oncelik_puani`
9. `kisa_ozet`

---

## Gemini output format (contract)

Gemini is prompted to return **JSON only** with fields:

```json
{
  "kategori": "string",
  "aciliyet_skoru": 8,
  "uygulama_zorlugu": "Orta",
  "maliyet_tahmini": "Yüksek",
  "etkilenen_kisi": 25,
  "anahtar_kelimeler": ["test", "otomasyon"],
  "sentiment": "Pozitif",
  "oncelik_puani": 75,
  "kisa_ozet": "string"
}
```

The script:
- strips ```json fences if present
- parses JSON
- converts `anahtar_kelimeler` array → comma-separated string
- fills defaults if some fields are missing

---

## Installation / Deployment (Google Apps Script)

### Step 1 — Create your Spreadsheet + Sheets
1. Create a Google Spreadsheet
2. Add two tabs named:
   - `Ham Veri`
   - `AI Analizi`

### Step 2 — Link your Google Form (optional but recommended)
If you’re using Google Forms:
1. Create a Google Form for employee suggestions
2. In Form responses, click **Link to Sheets** and select the spreadsheet above
3. Make sure the responses sheet is named **Ham Veri** (rename if needed)

### Step 3 — Add Apps Script
1. Open the Spreadsheet
2. Go to **Extensions → Apps Script**
3. Paste the contents of `script.gs` into the editor

### Step 4 — Configure constants
At the top of `script.gs`, set:

- `GEMINI_API_KEY` — your Gemini API key
- `SPREADSHEET_ID` — the ID of your spreadsheet

**Important:** In the current file, these lines appear with a `#` prefix. In Apps Script (JavaScript), `#` is not a valid comment character.
You should update them to valid JavaScript, e.g.:

```js
const GEMINI_API_KEY = 'YOUR_KEY_HERE';
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
```

### Step 5 — Authorize
1. In Apps Script, run `analyzeNewRows()` once
2. Accept the permission prompts (Sheets access + external requests via `UrlFetchApp`)

---

## Usage

After installing, reload the spreadsheet. A custom menu will appear:

**🤖 AI Analizi**
- ▶️ **Otomasyonu Başlat** → `setupAutoAnalysis()`
- ⏹️ **Otomasyonu Durdur** → `stopAutoAnalysis()`
- 🔄 **Şimdi Kontrol Et** → `analyzeNewRows()`
- 🧪 **Test (Tek Satır)** → `testSingleRow()`

### Start automation
Use **🤖 AI Analizi → ▶️ Otomasyonu Başlat**.

This will:
- remove any existing triggers for `analyzeNewRows`
- create a new time-based trigger that runs every **10 minutes**
- immediately run `analyzeNewRows()` once

### Stop automation
Use **🤖 AI Analizi → ⏹️ Otomasyonu Durdur** to delete the trigger.

### Manual run
Use **🤖 AI Analizi → 🔄 Şimdi Kontrol Et** to process new rows immediately.

### Quick test
Use **🤖 AI Analizi → 🧪 Test (Tek Satır)** to analyze the *last row* in `Ham Veri` and log the outcome (it does not write a new row to `AI Analizi` in this test function; it primarily validates API + parsing behavior).

---

## How “new rows” are detected

`analyzeNewRows()` compares:

- `hamVeriLastRow = hamVeriSheet.getLastRow()`
- `aiAnalizLastRow = aiAnalizSheet.getLastRow()`

If `Ham Veri` has more rows than `AI Analizi`, it processes rows:

- `startRow = aiAnalizLastRow + 1`
- `endRow = hamVeriLastRow`

This prevents reprocessing older suggestions.

---

## Error handling / reliability notes

- Empty suggestions (column D) are skipped.
- Gemini calls use a retry loop (up to 3 attempts):
  - handles HTTP **429 rate limits** with increasing delays (10s, 20s, 30s)
  - retries some non-200 failures
- If Gemini fails entirely for a row, the script writes a placeholder “error” entry to **AI Analizi** so row alignment is preserved.
- A `Utilities.sleep(5000)` delay is applied between rows to reduce rate-limit risk.

---

## Customization

Common edits you may want:

- **Change analysis frequency**:
  - in `setupAutoAnalysis()` adjust `.everyMinutes(10)` (Apps Script supports certain minute intervals)
- **Adjust the categorization schema**:
  - edit the category list in `buildPrompt()`
- **Add/Remove output fields**:
  - update:
    - the prompt JSON schema in `buildPrompt()`
    - the write range size (`setValues` width)
    - the parsing/default logic in `parseGeminiResponse()`

---

## Security considerations

- Do **not** commit real API keys to a public repository.
- Prefer storing secrets in:
  - Apps Script Properties (`PropertiesService`) or
  - Google Cloud secret management (advanced setups)

---

## Troubleshooting

### Menu doesn’t appear
- Reload the spreadsheet.
- Confirm `onOpen()` exists in the script and the file is bound to the spreadsheet.

### “Sayfalar bulunamadı” (Sheets not found)
- Ensure sheet/tab names are exactly:
  - `Ham Veri`
  - `AI Analizi`

### API errors
- Verify your Gemini key is valid and enabled.
- Check Apps Script logs: **Extensions → Apps Script → Executions** / Logs.
- If you frequently hit 429:
  - increase the per-row sleep delay
  - decrease trigger frequency
  - reduce token/output size (`maxOutputTokens`)

---

## Example links (demo)

The original repo README referenced sample links:

- Spreadsheet (example): https://docs.google.com/spreadsheets/d/e/2PACX-1vT3rX7mFCHSojEdMhU11P2_s5L4A9qKJtDMuqUOIUffjH10l2cxHHjV-9gjQ_YII-3FzauNkxiCv0J-/pubhtml
- Form (example): https://forms.gle/7kDj9ftAXGXgX2d39
