# Task E (bonus) — Шлях 1: пайплайн по-справжньому

> Обрано **один** шлях — перший. Запускався [`pipeline/ai-review.yml`](../pipeline/ai-review.yml), скопійований у
> `.github/workflows/` **лише в демо-гілці форку**: шість версій по ходу виправлень, остання (v6) байт у байт та,
> що в цьому PR. У PR курсу `.github/workflows/` немає, і
> засіяні дифи в `app/` теж не комітились: вони живуть тільки в демо-гілках форку.

## Шлях 1 — пайплайн по-справжньому

- **Форк:** <https://github.com/Fyfar/2026-udc-10-code-review-hw>. Гілки лише для демо:
  - `ci-demo-base` = коміт Task C + workflow у `.github/workflows/ai-review.yml`. Для неї діє ruleset
    «ci-demo: required checks», який вимагає `tests (required)` і `gate (required)`;
  - `ci-demo-pr5`, `ci-demo-pr2` = `ci-demo-base` + засіяний диф `review-queue/pr-5|pr-2/change.diff`, накладений на `app/`.
- **PR, на яких запустився workflow** (усередині форку, база `ci-demo-base`):
  - [#1 — PR-5: Пільговий день для штрафу за прострочення](https://github.com/Fyfar/2026-udc-10-code-review-hw/pull/1).
    Гейт пройдено, з'явився AI-коментар;
  - [#2 — PR-2: Email учасника у звіті про прострочення](https://github.com/Fyfar/2026-udc-10-code-review-hw/pull/2).
    Гейт заблокував PR, AI-рев'ю не запускалось.

### Прогони

Версії workflow (кожна зміна — окремий коміт у `ci-demo-base`): **v1** — перша версія; **v2** — Node 24 і
відрізання преамбули; **v3** — вартість у логах; **v4** — виправлення після незалежного рев'ю (CLI `2.1.296`,
`--model claude-haiku-5-5`, `--restricted`, бюджет, фільтр до завантаження артефакту, коментар із маркером);
**v5** — промпт називає файл команди, а не slash-команду, і є відмова публікувати «не-рев'ю»; **v6** —
обрізання коментаря, безпечне для glibc `iconv` (проблема 10), і `modelUsage`, безпечне для `null`. **v6 — це
файл `pipeline/ai-review.yml` у цьому PR, байт у байт.**

| Прогін | PR | Версія | `tests (required)` | `gate (required)` | `AI review (advisory)` | `post advisory comment` | Що показав |
|---|---|---|---|---|---|---|---|
| [38160848536](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38160848536) | #1 | v1 | ✅ 8 с | ✅ 8 с, `tests: n/a` | ✅ 1 хв 49 с | ✅ 5 с | перший робочий прогін; проблеми 4–6 у таблиці нижче |
| [38160850048](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38160850048) | #2 | v1 | ✅ 6 с | ❌ 5 с, `GATE BLOCKED — 3 block(s)` (G5, G6, G6) | ⏭ | ⏭ | **спершу детерміновані**: модель не бачить PR, який уже відхилив код |
| [38161056954](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38161056954) | #1 | v2 | ✅ 7 с | ✅ 6 с, `tests 13, pass 13, fail 0` | ✅ 1 хв 57 с | ✅ 6 с | коментар без преамбули |
| [38161060028](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38161060028) | #2 | v2 | ✅ 6 с | ❌ 7 с, `GATE BLOCKED — 3 block(s), 0 warning(s); tests: tests 13, pass 13, fail 0` | ⏭ | ⏭ | підсумок тестів у гейті тепер видно |
| [38161253549](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38161253549) | #1 | v3 | ✅ 7 с | ✅ 7 с | ✅ 1 хв 26 с | ✅ 7 с | 73,6 с, 9 ходів, 67 229 токенів, оцінка CLI $0,081 — **на `claude-haiku-4-5`** (проблема 7) |
| [38163251986](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38163251986) | #2 | v4 | ✅ 6 с | ❌ 5 с | ⏭ | ⏭ | з ruleset PR #2 має стан `BLOCKED`: злиття справді заблоковане |
| [38163247854](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38163247854) | #1 | v4 | ✅ 7 с | ✅ 8 с | ✅ 14 с | ✅ 8 с | **«не-рев'ю»**: 3 ходи, $0,0012, «`/review-pr` is not installed in this session» (проблема 8) |
| [38163414739](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38163414739) | #2 | v5 | ✅ 6 с | ❌ 6 с | ⏭ | ⏭ | без змін: блок гейта |
| [38163410913](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38163410913) | #1 | v5 | ✅ 7 с | ✅ 9 с | ✅ 56 с | ✅ 6 с | перший на `claude-haiku-5-5`: 45,1 с, 10 ходів, 63 611 токенів (8 вх. + 9 542 вих. + 36 704 cache read + 17 357 cache write), оцінка CLI **$0,0086**; знайдено **обидва** дефекти PR-5 |
| [38165053186](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38165053186) | #2 | v6 | ✅ 4 с | ❌ 7 с | ⏭ | ⏭ | блок гейта, PR `BLOCKED` |
| [38165050951](https://github.com/Fyfar/2026-udc-10-code-review-hw/actions/runs/38165050951) | #1 | v6 | ✅ 6 с | ✅ 9 с | ✅ 51 с | ✅ 5 с | **фінальний**: `claude-haiku-5-5`, 35,8 с, 8 ходів, 58 669 токенів (8 + 7 388 + 36 685 + 14 588), оцінка CLI **$0,0070**; 5-D1 — знахідка, 5-D2 — **лише питання** («a business decision, so I did not treat it as a finding»), тобто за правилами підрахунку пропуск |

Після фінального прогону PR #1 має стан `CLEAN`, хоча AI написав `BLOCK`: AI-вердикт дорадчий, а
обов'язкові `tests (required)` і `gate (required)` зелені. PR #2 має стан `BLOCKED` через червоний
`gate (required)`. Прямий push у `ci-demo-base` ruleset теж відхилив: «push declined due to repository rule
violations». Для оновлення workflow його вимикали на час push і одразу вмикали знову.

### Коментар бота

`github-actions[bot]`, [PR #1 — коментар із маркером `<!-- ai-review -->`](https://github.com/Fyfar/2026-udc-10-code-review-hw/pull/1#issuecomment-6112168540).
Він створений у v4 і оновлювався у v5 і v6; версію v5 з обома знахідками видно в історії правок коментаря
(«edited»). Нижче текст після фінального прогону 38165050951 (v6). Рядки наведено дослівно, але скорочено:
«…» позначає пропуск у рядку; пропущено рядки «Where»/«Quote» у F1, два рядки таблиці R13 і два питання.
Маркер `<!-- ai-review -->` (перший рядок коментаря) GitHub не показує.

> ## 🤖 AI review (advisory)
>
> > `/review-pr` (claude-haiku-5-5) on 56255e6. **Not a check: it does not block or approve.** Merging needs the required checks `tests (required)` and `gate (required)` and a human approval.
>
> # Review: PR ci — PR-5: Пільговий день для штрафу за прострочення
>
> ## Gate
> ```
> GATE PASSED — 0 block(s), 0 warning(s); tests: tests 13, pass 13, fail 0; checks: G0–G14
> ```
>
> ## Findings
> ### F1 — Two fee tests loosened from exact amounts to `> 0`, so the grace-day logic is no longer tested
> - Rule: R11 (Test checks a concrete result; tests not weakened to pass the change) · Severity: medium · Blocks: yes
>
> ## Description vs code (R13)
> | Claim in PR.md | Matches code? | Evidence |
> |---|---|---|
> | "Нова політика бібліотеки з 1 листопада" (new policy from 1 November) | Not gated by date | No date check in `lateFee` (app/src/loans.js:39–43). The grace applies to every fee computed, including dates in October. See Questions. |
>
> ## Questions / could not verify
> - The PR says the policy starts 1 November, but the code applies the grace to all dates now. A loan that is 3 days late and assessed on 2026-10-20 gets 1000 kopecks instead of 1500. Is that intended, or should `lateFee` be gated on a policy date? This is a business decision, so I did not treat it as a finding.
>
> ## Verdict
> BLOCK
> Reason: F1 has `Blocks: yes` (R11). The gate passed with no BLOCK lines, but the blocking finding alone sets the verdict.

На PR #1 є ще [попередній коментар](https://github.com/Fyfar/2026-udc-10-code-review-hw/pull/1#issuecomment-6111864780)
від v1–v3, що оновлювався через `--edit-last`. Його залишено як доказ проблеми 7 і позначено «⚠️ Superseded»;
останній його вміст — від прогону 38161253549.

### Що пішло не так і як полагодили

| # | Проблема | Причина | Як полагодили |
|---|---|---|---|
| 1 | AI без секретів через GitHub Models (`GITHUB_TOKEN` + `models: read`) неможливий | **GitHub Models вимкнено 30.07.2026** ([changelog](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)) | Claude Code CLI із секретом `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`). Власник додав секрет у форк через UI, агент його не бачив (до v1) |
| 2 | `git push` у форк по HTTPS → 403 | у сесії агента fine-grained PAT без `contents: write`, а для файлу workflow ще потрібен `workflows` | push по SSH-ключу власника; агенту права на запис у репо не розширювали (до v1) |
| 3 | PR відкриті, але **жодного прогону**, навіть невдалого check suite. На вкладці Actions лише «Get started» | Workflows у форку вимкнені, доки власник не підтвердить на вкладці Actions, а кнопка з'являється лише тоді, коли workflow є в **default-гілці**. У `main` форку його немає | Тимчасово зробили `ci-demo-base` default-гілкою, натиснули «I understand my workflows…» і повернули `main`. PR перезапущено через close/reopen (подія `reopened`; до v1) |
| 4 | Коментар починався з «Now I have all the context needed. Let me analyze…» | у `-p` фінальна відповідь містить і міркування перед звітом | коментар публікується від рядка `# Review:` (v2) |
| 5 | У CI гейт писав `tests: n/a`, а локально `tests 13, pass 13` | Гейт запускає `node --test` через `spawnSync`, тобто з перенаправленим виводом. Node 22 у такому разі друкує TAP (`# tests 13`), а Node ≥ 23 — формат spec (`ℹ tests 13`), на який розрахований регулярний вираз підсумку. Локально стоїть Node 26. Вердикт G1 від цього не залежав, бо він дивиться на код виходу | `node-version: 24` (LTS; застосунок вимагає `>=22`). Гейт не чіпали (v2) |
| 6 | Вартість не видно | вивід `text` не містить usage | `--output-format json`; рев'ю — `jq -r '.result // empty'`, а в Job Summary і лог — лише `duration_ms`, `num_turns`, `total_cost_usd`, `models`, `usage` (v3; `models` — з v4) |
| 7 | **CI рев'юїв не тією моделлю, яку міряли.** У v1–v3 CI знайшов ослаблені тести (5-D1) у 3 з 3 прогонів і **пропустив** дефект «пільга діє одразу, хоча політика — з 1 листопада» (5-D2) у 3 з 3. Субагенти Haiku в Task B/C знаходили обидва (`docs/review-scorecard.md`, рядок PR-5) | Незалежне рев'ю Task D/E вказало на незакріплений аліас `haiku`. Локальна перевірка 7 версій CLI (`docs/pipeline.md`, «Закріплені версії») показала, що закріплений тоді Claude Code `2.1.283` розв'язує `--model haiku` у **`claude-haiku-4-5`**, а Task B/C працювали на `2.1.296`, де `haiku` = `claude-haiku-5-5` (за транскриптом сесії Task B/C: усі 22 субагенти-рев'юери — `claude-haiku-5-5`, CLI `2.1.296`). У логах v3 поля `modelUsage` ще не було, тож модель v1–v3 встановлено відтворенням з тією ж версією CLI, а не з логу. Непрямий доказ: за подібної кількості токенів v3 коштував $0,081, а v5 — $0,0086, тобто ~9,4× різниці в ціні. Між v3 і v5 змінились одночасно версія CLI, модель, `--restricted` і спосіб запуску команди, тож модель — **імовірна** причина пропуску, а не доведена | CLI `2.1.296` + `--model claude-haiku-5-5` повним id; `models` тепер пишеться в лог. На `claude-haiku-5-5` 5-D2 знайдено в 1 з 2 прогонів (v5 — знахідка, v6 — лише питання), на `claude-haiku-4-5` — у 0 з 3, навіть як питання (v4) |
| 8 | Після переходу на `--restricted` бот опублікував «не-рев'ю»: «`/review-pr` is not installed in this session» | У CI `--restricted` не завантажив slash-команду проєкту, хоча локально (macOS) той самий виклик спрацював; причину розбіжності не з'ясовано, тому команду більше не викликають як slash-команду. Коментар публікував будь-який вихід, якщо не було заголовка | Промпт тепер називає файл: `Read .claude/commands/review-pr.md and carry it out exactly, with $ARGUMENTS = ci.` Вихід без `# Review:` і `## Verdict` не публікується, а job стає червоним (fail closed) (v5) |
| 9 | Назва «required» нічого не означала: у форку не було ні branch protection, ні ruleset, тож рядок бота v1–v3 «Merge is gated by the required checks `tests` and `gate`» був неправдою | обов'язковість check налаштовується в репо, а не в YAML | ruleset «ci-demo: required checks» на `ci-demo-base` (`tests (required)`, `gate (required)`). Після цього PR #2 має стан `BLOCKED`, а прямий push у базу відхилено (налаштування репо, між v3 і v4) |
| 10 | (знайдено незалежним повторним рев'ю, у CI не траплялось) Рев'ю довше за 60 000 байтів, обрізане посеред кириличного символу, не публікувалось би | glibc `iconv -c` відкидає обрізаний символ, але все одно виходить з кодом 1, а з `-eo pipefail` це валить крок. Відтворено в `ubuntu:24.04` | `head -c` → файл, потім `iconv -c … \|\| true` (вихід уже правильний). Перевірено в тому ж контейнері: крок не падає, UTF-8 валідний (v6) |

## Висновок

- **Пайплайн працює end-to-end, і безпекові межі видно в справжніх прогонах.** Секрет у логах
  замаскований (`***`). AI-job має лише `contents: read`, а модель — лише Read/Grep/Glob у межах checkout.
  Коментар пише окремий job без секрету. PR-2 зупинився на гейті, і модель його не побачила. Злиття блокує лише червоний
  обов'язковий check, а не текст AI.
- **Recall CI-рев'юера треба міряти в CI.** Ім'я моделі в конфігу («haiku») ще не означає ту саму модель:
  аліас залежав від версії CLI, тож v1–v3 працювали на `claude-haiku-4-5` і тричі пропустили дефект (5-D2),
  який рев'юер Task B/C знаходив. Після закріплення `claude-haiku-5-5` 5-D2 знайдено в 1 з 2 прогонів, а в
  другому він лише питання. Отже, модель — імовірний чинник, але й на правильній моделі результат
  нестабільний, а інші змінні (версія CLI, `--restricted`, спосіб запуску) не ізольовано. Тепер версію CLI і
  модель закріплено точно, модель пишеться в лог кожного прогону, а AI лишається дорадчим.
- **Вартість на PR (фінальна конфігурація):** ~1 хв реального часу для AI-job (36–45 с роботи моделі),
  59–64 тис. токенів, оцінка CLI $0,0070–0,0086. Фактично це йде з ліміту підписки (OAuth), а не з рахунку
  API. Детерміновані checks займають ~4–9 с і нічого не коштують.
- **Що не перевірено в демо:** PR із чужого форку (потрібен другий акаунт) і обмеження `--restricted` на
  Linux-раннері. Друге перевірено лише локально на macOS з тією самою версією CLI.
