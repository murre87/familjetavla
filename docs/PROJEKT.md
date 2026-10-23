# Familjetavla – projektbeskrivning för granskning

> Status 2026-10-18 (version 3, efter två granskningsrundor). Skrivet för att kunna granskas av någon annan (människa eller AI): vad bygger vi, hur, vilka beslut är tagna, vad saknas och var finns riskerna. Kommentera gärna direkt per avsnitt.
>
> Senaste granskningsunderlag: **[GRANSKNING.md](GRANSKNING.md)**. Hör ihop med **[DESIGN.md](DESIGN.md)** (designsystemet i detalj). Klickbar demo utan server: `docs/demo/familjetavla-demo.html` (öppna i webbläsaren; `#ipad` visar den i iPad-storlek, `#forsta` som nyinstallerad).

Repo: https://github.com/murre87/familjetavla (MIT-licens, publikt)

---

## 1. Vad är det?

En **familjetavla för surfplattan i hallen/köket**, t.ex. en iPad Pro på väggen. Den samlar det en svensk barnfamilj behöver se varje dag på ett ställe:

- **Nu-zonen**: det som händer härnäst, läsbart från andra sidan rummet ("Om 45 min · Middag")
- familjens kalendrar och de kommande 7 dagarna
- **barnvecka** (växelvis boende): vilka veckor barnen är hemma, nedräkning till bytet
- barnens **sport** (SportAdmin, laget.se) – bara på barnveckorna, men t.ex. matcher alla veckor
- **dit och hem** för barnens aktiviteter: vem skjutsar, blir skjutsad (med vem), buss eller cykel
- **skola** (Vklass, och andra plattformar via kalenderlänk): idrott → "ta gympapåsen", skolmat
- **sophämtning** för adressen
- **elpris** timme för timme med billigaste timmarna, inkl. eget påslag/nät/moms
- **inköpslista** som kan skickas till **Willys/Hemköp**-varukorgen
- hemmet via **Home Assistant**: bilar, ljus, värme/värmepump/spabad, solel/nät, grafer
- påminnelser: "Regn i eftermiddag – ta regnjackan", "Matavfall hämtas imorgon – ställ ut kärlet ikväll"

Målet är att **vem som helst** med Home Assistant ska kunna installera det och klicka sig igenom en **visuell installationsguide** – utan YAML och utan att vara utvecklare.

Inspiration: Skylight/Cozyla/DAKboard (färdiga familjeskärmar), OneHub Family (SportAdmin/laget.se/Meitner i en kalender), Samsas (svensk familjeapp med HA-integration), samt Emils egen HA-app (flikar Bil/Ljus/Hus/Energi/Schema/Grafer, glasdesign, dygnsfärger).

## 2. Målgrupp och principer

- Svenska familjer – med eller utan växelvis boende, ofta blandat i samma hushåll – som gärna (men inte nödvändigtvis) kör Home Assistant. Ingen familjeform är standard: nya barn bor här "hela tiden" tills man väljer annat.
- **Märkesoberoende**: bilar, växelriktare, värmepumpar, spabad, elbolag m.m. läses via Home Assistant – appen ska inte behöva känna till varje märke.
- **Hämta automatiskt från HA** det som redan finns integrerat; användaren bockar bara ur.
- **Leverantörsmoduler** för det som inte finns i HA (skola, mataffär, sopor, elpris): en fil per leverantör, guiden ritar formulären själv.
- **Allt lokalt**: körs hemma, inga molntjänster av oss, lösenord krypterade på disk.
- iPad-först, men fungerar på telefon och dator (responsivt).

## 3. Arkitektur

```
┌────────────── iPad / webbläsare ──────────────┐
│  React-app (Vite): Tavlan + Installationsguide │   hash-routing (#/, #/setup)
└──────────────────────┬────────────────────────┘
                       │ relativa anrop "api/…" (fungerar bakom HA ingress)
┌──────────────────────▼────────────────────────┐
│  Node 22 + Fastify (TypeScript)                │
│  ├─ dashboard.ts   bygger hela tavlan i ett svar│
│  ├─ providers/     skola · mataffär · sopor · el│
│  ├─ connectors/    ics, ha, vklass, axfood, edp,│
│  │                 elpris, väder, postnummer    │
│  ├─ discovery.ts   läser HA:s enhets/rumsregister│
│  ├─ scheduler.ts   tidsstyrning (värmestart m.m.)│
│  └─ store.ts       /data: config.json + krypterade hemligheter│
└──────┬───────────────┬──────────────┬─────────┘
       │               │              │
 Home Assistant   Externa källor   Headless Chromium
 (REST + template) (ICS, Vklass,   (bara för Willys/
                    EDP, elpris,     Hemköp-inloggning)
                    Open-Meteo, OSM)
```

**Varför fristående app och inte en HACS-integration?** Störst frihet: Willys kräver inloggning via riktig webbläsare (headless Chromium), Vklass/sopor är skrapning/HTTP, vi vill ha eget UI och egen schemaläggare. Det går inte bra inuti en HA-integration. Appen pratar i stället med HA via API. (En tunn HACS-integration som exponerar tavlans data som entiteter kan läggas till senare.)

**Distribution**
- **Home Assistant-tillägg (add-on)** med ingress → syns i HA:s sidomeny, ingen egen inloggning, HA-token automatiskt (`SUPERVISOR_TOKEN`).
- **Docker / docker-compose** för den som kör HA Container eller vill köra separat (då anges HA-adress + långlivad token).
- Färdiga images byggs av GitHub Actions till GHCR (amd64 + aarch64).

**Lagring** (`/data`)
- `config.json` – inställningar, inga hemligheter
- `secrets.json` – lösenord, tokens, privata kalenderlänkar, sessioner (AES-256-GCM)
- `secret.key` – nyckeln (skapas vid första start, chmod 600)
- `local.json` – inbyggd inköpslista om HA:s inte används, samt dit/hem-val per händelse (rensas efter två dagar)
- `photos/` – bilder till fotoramen i viloläget

**Säkerhet**
- Hemligheter skickas aldrig tillbaka till webbläsaren (bara "är satt").
- Valfri **PIN-kod** för inställningar när den körs utanför HA. I tillägget litar vi bara på anrop från Supervisor-IP (172.30.32.2) via ingress.
- Tavlans vardagsknappar (ljus, inköpslista, värmestart) kräver inte PIN – den ska kunna användas av barnen.
- Validering med zod av all konfiguration; leverantörers hemliga fält vitlistas per leverantör.

## 4. Funktioner

### 4.1 Hem (familjetavlan)
Layout och utseende beskrivs i detalj i [DESIGN.md](DESIGN.md). Kort:

- **Sidhuvud**: datum, vecka, väder, stor klocka, avatarer för familjen (den som är på andra hemmet nedtonad), temaknapp, inställningar.
- **Nu-zon** (överst, dubbel bredd): rubrik som räknas ut ("Om 45 min", "Pågår: …", "Imorgon kl 07:45"), de tre nästa tidsatta händelserna fram till slutet av imorgon med ikon, person och skjuts, samt vädret just nu i stort format.
- **Kom ihåg** (max 5): regn, barnen kommer/åker imorgon, sport idag/imorgon → "Packa väskan · Emil skjutsar dit · buss hem" (eller "välj skjuts"), idrott (Vklass) → gympapåse, sophämtning, skolmat. Efter kl. 17 visas morgondagen.
- **Barnvecka**: rubrik ("Ella och Leo kommer imorgon"), nästa byte + vecka, ring med dagar kvar.
- **Kommande 7 dagar**: Idag och Imorgon större, resten kompakt. Händelser som piller med **aktivitetsikon** (boll, simning, musik, tårta, läkare, resa, sopor, mat, skola… gissas från titel och kalendernamn), tid, titel, personens avatar och en liten **skjutsmarkering** (bil/buss/cykel dit ⇄ hem, eller "?" om inget är valt). Heldag först, "X kommer/åker" på bytesdagar, sophämtning som egen händelse. Skollektioner döljs utom idrott och heldag.
- **Tryck på en händelse** → ark med tid, plats, person och – för barnens aktiviteter – **Dit/Hem**-väljare.
- **Inköpslista**: bocka av, lägg till, rensa, "Skicka till Willys".
- **Elpris**: nu (rullande siffra), nivå, staplar 24 h, billigaste sammanhängande block.
- Bilar (kort), ljus-snabbknappar, temperaturer, energi, klimat – av/på och i valfri ordning under Visning.
- **Viloläge / fotoram**: efter X minuter utan beröring (standard 10) tonar tavlan över till familjens bilder (eller den levande himlen) med klocka, nästa händelse och temperatur. Tryck för att väcka.
- **Nattläge**: svart skärm med klocka mellan valda tider, pixelförskjutning, tryck för att väcka 2 min.
- **Gester**: svep mellan flikar, dra nedåt för att uppdatera.

### 4.1b Dit och hem (skjuts) för barnens aktiviteter
- Gäller händelser som tillhör ett **barn** (sport, egna kalendrar) – inte skollektioner eller heldag.
- För **Dit** och **Hem** var för sig: "<vuxen> skjutsar" (en knapp per vuxen i familjen), **Blir skjutsad** (valfritt "med vem?", t.ex. "Saras pappa"), **Buss**, **Cyklar/går**.
- Valet gäller det enskilda tillfället, eller med **"Använd för alla i Fotboll F14"** som standard för hela kalendern. Ett eget val för ett tillfälle vinner alltid över standarden.
- Syns i Nu-zonen ("Emil skjutsar dit · skjuts med Saras pappa hem"), i Kom ihåg och som ikon på pillret i veckan.
- Lagring: standard i `config.json` (`calendars[].travel`), enskilda val i `local.json` med nyckel `<kalender-id>@<starttid ISO>`. API: `POST /api/travel { key, choice, forCalendar }` (kräver inte PIN – ska kunna ändras från tavlan).

### 4.2 Flikar (visas bara om de har innehåll)
- **Bil**: per bil batteriring, räckvidd, hemma/borta, laddar, "data X h gammal". **Alla data**: hela bilens HA-enhet grupperad (Batteri & laddning, Klimat, Körning & däck, Lås & luckor, Plats, System, Övrigt), ✓ färskt / ⚠ otillgängligt eller äldre än 12 h. Bilens egna knappar (Blinka, Tuta, Uppdatera, Starta laddning) blir tryckbara. **Starta värme nu** + **schema per veckodag**.
- **Ljus**: grupper per rum med "Tänd alla / Släck alla", "6 av 8 tända · offline: …"; egna knappar för scener/skript (t.ex. "Godnatt – släck uppe").
- **Hus**: kort per `climate`/`water_heater` (värmepump, termostat, varmvatten, spabad) med aktuell/mål-temp och lägen från enheten (Auto/Värme/Eco…). Spabad (Balboa, Gecko…) får pumpar/ljus/blåsare som knappar. **Enhetskort** för värmepumpar som bara ger sensorer/reglage (Husdata H60/H66, Nibe, Thermia, IVT, CTC): huvudvärde, rader och reglage (till/från, val, −/+).
- **Energi**: solel, nät (köper/säljer med flödespil), husets effekt, hembatteri.
- **Grafer**: senaste dygnet för valda sensorer (HA-historik, 30-min medel) + elpris.

### 4.3 Installationsguiden (visuell, steg för steg)
1. **Hem**: hushållets namn, **postnummer** → ort, koordinater (väder), förslag på **elområde SE1–4** och **kommun** (förväljer sophämtning).
2. **Familjen**: vuxna och barn, färg. Barn: boende *alltid / udda veckor / jämna veckor / varannan vecka från datum*, bytesdag. Förhandsvisning av kommande 8 veckor.
3. **Home Assistant**: automatiskt i tillägget, annars adress + token, Testa.
4. **Hämta från Home Assistant**: en knapp som hittar bilar, solel/växelriktare, nät, hembatteri, värme/klimat, spabad, värmepumpskort, lampor per rum, temperaturer, inköpslistor, kalendrar (inkl. sopkalender), elpris-sensor. Bocka ur det som inte ska med.
5. **Kalendrar**: Google (hemlig iCal-adress), iCloud (offentlig delning), laget.se (per lag), SportAdmin (Aktiviteter → Prenumerera), Outlook, annan ICS, eller HA-kalender. Per kalender: person, kategori, **lagfilter** (guiden hittar lag/grupper i flödet och man bockar i vilka som ska visas), dölj-ord, **"visa alltid om titeln innehåller…"** (t.ex. `match, cup` → matcher alla veckor, träningar bara barnveckor), eller "visa alla veckor".
6. **Skola**: Vklass (inloggning, barnen hittas och kopplas till personer) eller kalenderlänk för SchoolSoft/Unikum/IST/Skola24/InfoMentor/Edlevo.
7. **Sophämtning**: sök på adress (EDP Future, ~30 kommuner), **eget schema** (kärl, första hämtdag, intervall i veckor, ev. bara vissa månader), kalenderlänk, eller HA-kalender (Waste Collection Schedule, ~50 svenska renhållare).
8. **Mat & inköp**: inköpslista lokalt eller HA:s todo; butik Willys/Hemköp.
9. **El**: spotpris (elområde) eller HA-sensor (Nordpool/Tibber/elbolag) + påslag, nätavgift, energiskatt, moms, antal billiga timmar.
10. **Huset**: finjustera bilar, energi, ljus, knappar, klimat, enhetskort, grafer (entitetsväljare med sök).
11. **Visning / Klart**: välj och sortera rutor på startskärmen och flikar, tema (auto följer dygnet / mörkt / ljust), accentfärg, nattläge, viloläge efter X minuter, **fotoram** (ladda upp bilder, skalas ned i webbläsaren), PIN.

Varje leverantör har knappen **Testa** som visar riktiga exempelrader innan man sparar.

## 5. Leverantörsmoduler (det som inte går via HA)

Gränssnitt i `server/src/providers/types.ts`; registrering i `providers/registry.ts`. Varje modul deklarerar `meta.fields` (text, lösenord, url, val, entitet, schema…) och guiden ritar formuläret.

| Kategori | Leverantör | Hur | Status |
|---|---|---|---|
| Skola | **Vklass** | Inloggning användarnamn/lösenord → custodian.vklass.se, kalender per barn, skolmat från startsidan. Flöde kartlagt av HA-communityns "Vklass scrape sensor". | beta |
| Skola | Kalenderlänk | ICS från SchoolSoft, Unikum, IST, Skola24, InfoMentor, Edlevo… | stabil |
| Mataffär | **Willys** | Inloggning via headless Chromium (BankID går ej – kräver lösenord), sedan REST: sök, `cart/addProducts` med CSRF. Kartlagt av willys-mcp (MIT). | beta |
| Mataffär | Hemköp | Samma Axfood-plattform som Willys. | experimentell |
| Sopor | EDP Future | `SearchAdress` + `GetWastePickupSchedule`, lista över kommuner från Waste Collection Schedule (MIT). | beta |
| Sopor | Eget schema | Kärl + första datum + intervall + månader. | stabil |
| Sopor | ICS / HA-kalender | | stabil |
| Elpris | Spotpris | elprisetjustnu.se (15-min → timmedel), elområde. | stabil |
| Elpris | HA-sensor | Läser `raw_today/raw_tomorrow`, `today/tomorrow` eller `prices`-listor; öre → kr. | beta |

Kalenderkällor (Google/iCloud/laget.se/SportAdmin/Outlook/ICS/HA) är en egen, enklare mekanism eftersom alla är ICS eller HA-kalender.

**Önskade framtida moduler**: Coop, ICA, Mathem, City Gross (mataffär); SchoolSoft/Unikum/Skola24 inbyggt (inte bara ICS); Meitner/Edlevo; fler sopleverantörer direkt; Tibber/Greenely direkt.

## 6. Viktiga designbeslut

- **Barnvecka "varannan vecka från datum"** rekommenderas framför "udda veckor": 2026 har vecka 53, så udda veckor ger två i rad (v53 + v1). Byte på valfri veckodag (t.ex. fredag) stöds.
- **Kalenderupprepningar** expanderas i lokal "flytande" tid för att undvika rrule-buggar kring TZID och sommartid (testat över 25 okt 2026).
- **Elområde från postnummer** är en uppskattning från latitud/longitud (Svenska kraftnät har inget öppet postnummerregister) – visas som förslag.
- **Cache med "stale-if-error"**: om Vklass/Willys/elpris strular visas senaste fungerande data, och felet syns diskret ("2 källor svarar inte").
- **Skollektioner döljs** på tavlan (för mycket brus) – bara idrott och heldag visas, plus påminnelse.
- **Hash-routing + relativa API-sökvägar** för att fungera bakom HA ingress.
- **Ett anrop bygger hela tavlan** (`GET /api/dashboard`), pollas varje minut + när plattan vaknar, och direkt vid ändringar via SSE.
- **Design 2026** ("Liquid Glass"): glaskort över en levande himmel som följer dygnsfas (gryning/dag/skymning/natt) och väder (regn/snö/dimma); tema "auto" byter ljust/mörkt efter fasen. Stora smala siffror (Bricolage Grotesque, variabel bredd) + Manrope. Fjäderrörelser, View Transitions mellan flikar, `prefers-reduced-motion` respekteras. Se DESIGN.md.
- **Skjuts per tillfälle med standard per kalender**: de flesta träningar är likadana varje vecka, men undantagen måste vara enkla att göra från tavlan.
- **iPad-förhandsvisning (`#ipad`)**: tavlan körs i en iframe på 1366 × 1024 och skalas ned, så layouten blir exakt som på iPad även på en Android-telefon eller laptop.

## 7. Kända risker och begränsningar

- **Inofficiella kopplingar** (Vklass, Willys/Hemköp, EDP) kan sluta fungera när sajterna ändras, och kan strida mot deras användarvillkor. De är markerade beta/experimentell och isolerade i egna moduler.
- **BankID** kan inte automatiseras: Vklass och Willys kräver konto med lösenord.
- **iPad som väggskärm**: ingen Fully Kiosk på iOS. Lösning: "Lägg till på hemskärmen" (fullskärm, PWA-meta finns) + Guidad åtkomst + automatisk låsning "Aldrig". Skärmväckning vid rörelse går inte på iPad.
- **Willys kräver Chromium** i containern (~300 MB större image).
- `POST /api/template` i HA används för enhets/rumsregistret – kräver admin-token (fungerar med tilläggets token och en admin-användares långlivade token).
- Tavlans vardagsknappar är oskyddade på lokala nätet om appen körs utanför HA utan omvänd proxy.
- Waste/EDP och SportAdmin/laget.se-flöden är inte verifierade mot verkliga konton ännu.

## 7b. Laddning av bil

Kortet **Laddning** startar/stoppar och visar bilens eget laddschema. Kortet **Laddschema** bredvid (`server/src/chargeplan.ts`, `GET/PUT/DELETE /api/car/:index/charging`):

1. **Läser in det som finns:** bilens laddgräns, laddboxar (Easee, Zaptec, Wallbox, Charge Amps, go-e, Ohme, Zappi, OCPP …), EV Smart Charging, samt scheman och automationer i HA som handlar om laddning. Allt går att ändra från tavlan.
2. **Eget laddschema** när man inte har något: tavlan skapar en **schemahjälpare** (`schedule.familjetavla_laddning_<bil>`) och en **automation** (`familjetavla_laddning_<bil>`) i HA som slår på/av laddningen och kan sätta laddgränsen. Det ligger kvar i HA och fungerar även när tavlan är avstängd. Fönster över midnatt (22–06) delas automatiskt i två block, eftersom HA:s scheman inte kan passera midnatt; tavlan slår ihop dem igen när den läser. Ändrar man schemat i HA syns det på tavlan.

Kräver WebSocket-anslutning och admin-token (samma som enhetsregistret).

## 8. Inte byggt ännu (medvetet utskjutet)

- Smart laddning på billigaste timmar ("klar till kl 07:00 med 80 %") – idag visas och styrs t.ex. EV Smart Charging om den finns i HA
- Effektvakt / peak shaving, effekttoppar per månad
- Styrning av värme efter elpris ("sänkt värme vid dyr el")
- SolarEdge exportbegränsning-reglage (går redan via enhetskort om HA har `number/select`)
- Notiser (spabad klart, tvätt klar, elbil startar) – via HA `notify`
- Sysslor/belöningar för barnen, matsedel/veckomeny, recept
- Röst ("lägg till mjölk") – går redan via HA Assist om HA:s todo-lista används
- Flera språk (bara svenska nu)
- Flera tavlor med olika vyer (t.ex. barnrummet)
- Tunn HACS-integration som exponerar tavlans data som entiteter

## 8b. Ändrat efter första granskningen (2026-10-18)

- **Undantag för barnveckan** (datumintervall hemma/borta) + valfri **byteskalender** (heldagshändelse med barnets namn = hemma, + "borta" = borta).
- **WebSocket mot HA** (live-states och `state_changed`) + **Server-Sent Events** till plattan → knapptryck syns direkt. REST används som reserv.
- **Registret via WebSocket** (`config/device_registry/list`, `entity_registry`, `area_registry`) i stället för `/api/template` (template finns kvar som reserv).
- **"Är du säker?"** på värmestart, bilens lås/knappar och värmelägen.
- **Sensorer tillbaka till HA:** `sensor.familjetavla_barnvecka_<namn>`, `sensor.familjetavla_nasta_sophamtning`.
- **Nattläge med pixelförskjutning**, guide för väckning via rörelsesensor och laddning 20–80 %.
- **Skolmat** från Skolmaten.se och från Skolmat-integrationen i HA; ICS + skolmat är huvudspåret, Vklass ett tillval.
- **Extern webbläsare** för Willys (`BROWSER_WS_URL`, t.ex. browserless) och möjlighet att bygga utan Chromium.
- **Valbar startskärm:** rutor och flikar av/på och i valfri ordning.
- **Leverantörer:** Hemköp (Axfood), eget sopschema, HA-elpris, enhetskort för värmepumpar (Husdata m.fl.), spabad med pumpar/ljus.

## 8c. Ändrat i omgång 2 (2026-10-18)

- **Ny design 2026** (DESIGN.md): Nu-zon, bento-layout, glas, levande himmel efter tid och väder, avatarer, aktivitetsikoner, rullande siffror, svep, dra-för-att-uppdatera, händelseark, fotoram i viloläget.
- **Dit/Hem (skjuts)** på barnens aktiviteter – "vem hämtar?" från förra granskningen (avsnitt 4.1b).
- **Större Idag/Imorgon med ikoner** i veckan.
- **iPad-vy** för att förhandsgranska på andra skärmar, och en demo som är en enda HTML-fil.

Kvar från förslagen: kollektivtrafik via Trafiklab (skulle passa ihop med "Buss" – visa avgång), veckomeny för middagar, notisbanners från HA, tvåstegsinloggning (SMS-kod) för ICA/Coop, notis till den som ska skjutsa ("Du kör Ella 17:00"), sensor tillbaka till HA för dagens skjutsar.

## 9. Teknik och kvalitet

- TypeScript strikt i server och webb, delade typer i `server/src/types.ts`.
- Tester (vitest, 39 st): skjutsval (eget vs kalenderstandard, etiketter), aktivitetsikoner, Nu-zonens rubrik, initialer vid krock, barnvecka inkl. v53 och fredagsbyte, ISO-veckor, ICS med upprepning och sommartid, elpris (15-min → timme, billigaste block, nivå), EDP-datumformat, lagfilter, matcher-alltid-regeln, eget sopschema, elområdesgissning, HA-prissensorer.
- Inga databaser – JSON-filer i `/data`.
- Inga externa UI-bibliotek; egen CSS med tokens för mörkt/ljust tema (React 19 + Vite 7).
- Demo-bygge (`npm run build:demo -w web`) byter API:t mot inspelad data i webbläsaren och paketerar allt i en HTML-fil.

## 10. Frågor till granskaren

1. Saknas något som en svensk familj med växelvis boende verkligen använder varje dag?
2. Är barnvecka-modellen tillräcklig? (T.ex. 2-2-3-schema, olika schema per barn, lov och helger som avviker, manuella undantag "byter vecka denna gång".)
3. Är leverantörsgränssnittet rätt abstraktion för att andra ska kunna bidra med ICA/Coop/SchoolSoft m.m.?
4. Säkerhet: räcker PIN + kryptering på disk? Borde vardagsknapparna kunna låsas?
5. Bör Willys-kopplingen alls finnas med tanke på villkor och skörhet – eller hellre "kopiera listan" + djuplänk?
6. Är fristående app + HA-tillägg rätt, eller borde kärnan vara en HACS-integration med ett Lovelace-kort?
7. Vad är viktigast att bygga härnäst av punkterna i avsnitt 8?
8. UX på iPad: är Nu-zon + 3 kolumner + flikar rätt, eller bör hemvyn vara ännu enklare för barnen?
9. Skjuts: räcker Dit/Hem med vuxen/skjutsad/buss/cykel? Behövs samåkning (flera barn i samma bil), avgångstid ("åk 16:50") eller notis till den som kör?
10. Designen: är glas + levande himmel läsbart nog på 2–3 meter i ett ljust kök? Är fotoramen i viloläget rätt standard eller ska den vara avstängd?
