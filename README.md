<p align="center"><img src="web/public/icon-180.png" width="96" alt=""></p>

# Familjetavla

**En familjetavla för surfplattan i hallen eller köket** – byggd för svenska familjer – med eller utan växelvis boende – som kör Home Assistant (men fungerar även utan).

Kalendrar, **barnvecka**, barnens **sport** (SportAdmin, laget.se) med **dit/hem** (vem skjutsar, buss eller skjuts), **skola** (schema, gympapåse, skolmat), **sophämtning**, **inköpslista** (som kan skickas till Willys), **elpris** med billigaste timmarna – och från Home Assistant: **bilar, ljus, musik, värmepump, spabad, solel och grafer**. Allt sätts upp i en **visuell guide**, utan YAML.

**[Prova demon i webbläsaren](https://murre87.github.io/familjetavla/demo/familjetavla-demo.html)**, ingen installation behövs.

> **In English:** a free family wall board for Home Assistant – the family's calendars, school, meals, waste pickup, electricity price and a live energy flow on a tablet. The interface is Swedish; calendars, lights, cars and energy work anywhere. [Try the demo](https://murre87.github.io/familjetavla/demo/familjetavla-demo.html) · [Contributing](CONTRIBUTING.md) · [Forum thread](https://community.home-assistant.io/t/familjetavla-a-family-wall-board-for-home-assistant-calendar-school-meals-waste-energy-flow/1029621)

![Familjetavlan på en iPad Pro](docs/screenshots/home-dark.png)

<table>
<tr>
<td><img src="docs/screenshots/home-light.png" alt="Ljust tema"></td>
<td><img src="docs/screenshots/tab-Bil.png" alt="Bil med värmestart och schema"></td>
</tr>
<tr>
<td><img src="docs/screenshots/tab-Hus.png" alt="Spabad och värmepump via Husdata"></td>
<td><img src="docs/screenshots/wiz-kalendrar.png" alt="Installationsguiden"></td>
</tr>
</table>

## Vad den gör

**Planera veckan och påminnelser**
- **Planera veckan:** allt de kommande 7 dagarna som behöver någon som lämnar, hämtar eller skjutsar – ett tryck per val. Det som saknar ansvarig syns i gult.
- **Veckans mat:** barnens skollunch bredvid familjens middagar – med varning om ni tänkt laga samma sak, och varorna rakt in i inköpslistan.
- **Påminnelser till rätt telefon** (via Home Assistant-appen): "Om 30 min: Hämta Maja på förskolan 16:00", kvällen innan kl 20, och söndag kl 19 om något saknar ansvarig. Eller en egen kalenderlänk per vuxen.

**Hemvyn**
- **Kom ihåg:** "Regn i eftermiddag – ta regnjackan", "Ella · Fotboll imorgon 17:30 – packa väskan", "Idrott tis – gympapåse", "Matavfall hämtas imorgon – ställ ut kärlet ikväll", "Barnen kommer imorgon". Efter kl. 17 visar den morgondagen.
- **Barnvecka:** nedräkning till nästa byte. Varannan vecka från valfritt datum (tål vecka 53), udda/jämna veckor, valfri bytesdag, **undantag** för lov och bytta helger, och en valfri **byteskalender**.
- **Kommande 7 dagar:** färg per person. Barnens sport syns bara på barnveckorna – men t.ex. **matcher alla veckor** om du vill.
- **Inköpslista** (egen eller Home Assistants), **elpris**, bilar, ljus och temperaturer.
- **Välj själv** vilka rutor som visas och i vilken ordning. Rutor utan data döljs.
- Ljust/mörkt tema eller **dygnsfärger**, nattläge med klocka som flyttar sig (skonar OLED).

**Flikar** (visas bara om du har något att visa)
- **Bil:** batteri, räckvidd, hemma/borta, "data 18 h gammal", **Alla data** (bilens alla entiteter i grupper, ✓/⚠), bilens knappar (blinka, tuta, lås), **Starta värme nu** och **schema per veckodag**.
- **Ljus:** rum med Tänd alla / Släck alla, "6 av 8 tända · offline: …", egna knappar för scener ("Godnatt – släck uppe").
- **Musik:** alla svenska radiokanaler (Sveriges Radio med alla P4, Mix Megapol, RIX FM …) i fliken Musik, favoriterna som en liten ruta på startsidan. Spelar i vald högtalare – Google Home/Nest, Chromecast, Sonos eller annat i Home Assistant – med Stopp och volym. Radion behöver inget extra.
  - **Spotify med spellistor, album, poddar och sök** (omslag som i bilens musikspelare) kräver [Music Assistant](https://music-assistant.io), gratis:
    - *Home Assistant OS:* Inställningar → Tillägg → Music Assistant → Installera. Fliken Musik har en knapp dit.
    - *Home Assistant i Docker:* starta Music Assistant som egen container (Portainer/Synology/Unraid eller `docker compose`), se texten nedan. Fliken Musik visar samma steg med en Kopiera-knapp.
    - Lägg sedan till Spotify i Music Assistant (Inställningar → Musikleverantörer) och integrationen Music Assistant i Home Assistant med adressen `http://<server>:8095`.

    ```yaml
    services:
      music-assistant:
        image: ghcr.io/music-assistant/server:latest
        restart: unless-stopped
        network_mode: host
        volumes:
          - ./music-assistant:/data
    ```
- **Smart laddning:** har du en smartstyrning som planerar laddningen (billigaste timmarna, solel) visas **planen** för de kommande 24 timmarna, och en laddknapp med **Auto / Ladda nu / Pausa** som ger samma överstyrning som styrningens egen app. Hittas automatiskt om styrningen följer [avtalet](docs/SMART-LADDNING.md).
- **Hus:** termostater, värmepump, varmvatten och **spabad** (Balboa, Gecko …) med lägen och pumpar. **Enhetskort** för värmepumpar som bara ger sensorer, t.ex. via **Husdata H60/H66**.
- **Energi:** solel, köp/sälj mot nätet, husets effekt, hembatteri – vilken växelriktare som helst.
- **Grafer:** senaste dygnet för valfria sensorer + elpris.

Tunga knappar (värmestart, lås, värmelägen) frågar "Är du säker?". Ändringar i Home Assistant syns direkt på tavlan (WebSocket).

**Tillbaka till Home Assistant:** tavlan skapar `sensor.familjetavla_barnvecka_<namn>` (hemma/borta) och `sensor.familjetavla_nasta_sophamtning` – perfekt för automationer som sänker värmen i barnrummet när barnen är i andra hemmet.

## Kopplingar

Allt som redan finns i Home Assistant (bilar, växelriktare, värmepump, spabad, laddbox, elmätare, lampor …) **hämtas automatiskt** – guiden har en knapp *Hämta från Home Assistant* och du bockar bara ur det du inte vill ha.

Det som inte finns i HA sköts av **leverantörsmoduler**:

| Område | Leverantör | Hur | Status |
|---|---|---|---|
| Kalender | Google, iCloud, Outlook, valfri ICS | Prenumerationslänk | stabil |
| Kalender | **laget.se** | Lagets kalender → Prenumerera (en länk per lag) | stabil |
| Kalender | **SportAdmin** | Appen → Aktiviteter → Prenumerera. **Lagfilter** om barnet har flera lag | stabil |
| Kalender | Home Assistant | Valfri `calendar.*` | stabil |
| Skola | SchoolSoft, Unikum, IST, Skola24, InfoMentor, Edlevo | Kalenderlänk (ICS) | stabil |
| Skolmat | **Skolmaten.se** | Ingen inloggning | beta |
| Skolmat | Skolmat-integrationen i HA | Mashie, Matilda, FoodIT, Mateo, skolmat.info | stabil |
| Skola och förskola | **Vklass** | Schema, idrott, omsorgstid, matsedel. Användarnamn + lösenord (inte BankID) | beta |
| Skola | **SchoolSoft** | Kalender och matsedel. Användarnamn + lösenord (inte BankID) | beta, nytt |
| Sopor | Sök på adress | 18 renhållare (EDP Future) – provas mot riktiga adresser varje vecka | stabil |
| Sopor | **SRV Återvinning** | Botkyrka, Haninge, Huddinge, Nynäshamn, Salem – sök på adress, provas varje vecka | stabil |
| Sopor | Eget schema | Kärl, en hämtdag, intervall, ev. vissa månader | stabil |
| Sopor | ICS eller HA-kalender | t.ex. Waste Collection Schedule (~50 svenska renhållare) | stabil |
| Mataffär | **Willys** | Inloggning via dold webbläsare, sedan varukorgen | beta |
| Mataffär | **ICA** | Personnummer + PIN som i ICA-appen; listan läggs i en inköpslista i appen (ingen varukorg) | experimentell |
| Mataffär | **City Gross** | E-post + lösenord; sök (öppen, per butik) och varukorg | experimentell |
| Mataffär | Hemköp | Samma plattform som Willys | experimentell |
| Elpris | Spotpris SE1–SE4 | elprisetjustnu.se + ditt påslag, nät, skatt, moms | stabil |
| Elpris | HA-sensor | Nordpool, Tibber m.fl. | beta |

> Vklass, SchoolSoft, Willys/Hemköp/ICA/City Gross, EDP och SRV är **inofficiella** kopplingar och kan sluta fungera när sajterna ändras. BankID går inte att automatisera – kontona behöver ett lösenord.

## Installera

### Som Home Assistant-tillägg (rekommenderas)

[![Lägg till i Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmurre87%2Ffamiljetavla)

1. Tryck på knappen ovan (eller **Inställningar → Tillägg → Tilläggsbutik → ⋮ → Förråd** och lägg till `https://github.com/murre87/familjetavla`).
2. Installera **Familjetavla**, tryck **Starta** och slå på **Visa i sidomenyn**.
3. Öppna Familjetavla. Guiden tar ungefär tio minuter, Home Assistant är redan anslutet, och allt utom *Hem* och *Familjen* kan hoppas över och fyllas i senare.

Tillägg kräver Home Assistant OS eller Supervised. Kör du Home Assistant i Docker (Container) – använd Docker nedan.

> **För dig som underhåller projektet:** tillägget hämtar en färdig image från GitHub. Den byggs när du skapar en release med en tagg som `v0.1.0` (samma version som i `familjetavla/config.yaml`). Gör paketen `familjetavla-amd64` och `familjetavla-aarch64` publika under GitHub → Packages om de blir privata.

### Med Docker

```bash
docker compose up -d     # se docker-compose.yml
```

Öppna `http://<datorn>:8099`. Ange Home Assistants adress (t.ex. `http://192.168.1.10:8123`, inte `localhost`) och en **långlivad token** från en administratör i guiden.

- **Sätt en PIN** i guidens sista steg. Då kommer bara skärmar som låsts upp med PIN-koden en gång åt tavlan – inte gäster eller andra enheter på wifi:t.
- **Uppdateras av sig själv:** `docker-compose.yml` startar också Watchtower, som hämtar nya versioner var sjätte timme. Vill du uppdatera själv, ta bort tjänsten `watchtower` och kör `docker compose pull && docker compose up -d`. Inställningarna ligger kvar i `./data`.

### Utan Home Assistant och utan Docker

Tavlan behöver inte Home Assistant. Välj **Jag har inte Home Assistant** i guiden. Då fungerar kalendrar, skjuts, skola (Vklass, SchoolSoft, skolmaten.se), sophämtning, elpris, väder, mat och inköpslista. Det som kräver Home Assistant är ljus, bilar, energi och andra prylar i hemmet.

Det går att köra på vilken dator som helst som är igång dygnet runt, till exempel en Raspberry Pi, en NAS eller en gammal laptop. Den behöver [Node.js 22](https://nodejs.org) eller nyare:

```bash
git clone https://github.com/murre87/familjetavla && cd familjetavla
npm install && npm run build
npm start                # öppna http://<datorn>:8099
```

- Inställningarna sparas i mappen `server/data`.
- För att uppdatera kör du `git pull && npm install && npm run build` och startar om.

### Prova i molnet först (ingen server behövs)

[![Öppna i GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/murre87/familjetavla?quickstart=1)

Startar tavlan på en tillfällig server hos GitHub – lägg in Vklass, kalendrar och resten och titta från iPad eller telefon. Home Assistant går inte att koppla in därifrån. Se [Prova i molnet](docs/PROVA-I-MOLNET.md).

## Väggplattan

- **Installera som app:** tryck på installera-knappen uppe till höger på tavlan – den visar exakt hur för just din iPad, Android eller dator.
- **Android-platta:** använd en kioskapp som **Fully Kiosk Browser** – helskärm, skärmen alltid på och start när plattan startar.
- **Helskärm på iPad:** öppna tavlan i Safari → Dela → **Lägg till på hemskärmen**. Då öppnas den utan adressfält.
- **Lås till tavlan:** Inställningar → Hjälpmedel → **Guidad åtkomst**. Sätt Inställningar → Skärm → Autolås till *Aldrig*, eller låt den släckas och väck den (nedan).
- **Väck med rörelsesensor:** med HA Companion-appen kan en automation skicka en notis till plattan när rörelsesensorn i hallen triggar, så att skärmen tänds. Annars väcker man med ett tryck.
- **Spara batteriet:** sätt laddaren i en smart plugg och låt en HA-automation ladda mellan 20 och 80 % (batterinivån finns som sensor via Companion-appen). Plattor som laddas till 100 % dygnet runt sväller ofta efter några år.
- **Direkt utan HA-inloggning:** slå på port 8099 för tillägget och använd `http://homeassistant.local:8099`. Sätt då en **PIN** – plattan låses upp med den en gång och kommer ihåg det.

## Säkerhet

- Allt körs hemma. Lösenord, token och privata kalenderlänkar sparas **krypterade** i `/data` och skickas aldrig till webbläsaren.
- Inställningarna kan låsas med **PIN**. I tillägget sköts inloggningen av Home Assistant.
- Vardagsknappar (ljus, inköpslista) kräver ingen PIN så att hela familjen kan använda tavlan. Kör den bara på ditt hemnätverk.

## Utveckla

```bash
npm install
npm run mock-ha          # en låtsas-Home Assistant med demodata på :8123
npm run dev              # server på :8099, webb på :5173
npm run seed             # lägg in en demofamilj
npm test                 # vitest
```

- `server/` – Node 22 + Fastify (TypeScript). `providers/` är leverantörsmodulerna, `connectors/` själva anropen, `discovery.ts` hittar saker i HA, `dashboard.ts` bygger tavlan.
- `web/` – React + Vite. `dashboard/` är tavlan, `setup/` installationsguiden.
- `familjetavla/` – Home Assistant-tillägget. `docs/PROJEKT.md` – projektbeskrivning och designbeslut, `docs/DESIGN.md` – designsystemet. Lägg till `#ipad` i adressen för att se tavlan som på en iPad (t.ex. på en Android-telefon i liggande läge).

### Bidra med en koppling eller ruta

Allt är moduler: en **datakälla** (skolplattform, renhållare, butik, elpris) är en fil i
`server/src/providers/`, en **ruta** på startsidan en fil i `web/src/widgets/`. Det finns en mall
för båda. Hur du gör, och hur du testar på alla skärmar, står i **[CONTRIBUTING.md](CONTRIBUTING.md)**.

Har du ingen kod men en plattform eller pryl som saknas? [Berätta här](../../issues/new/choose).

Önskas: ICA, Coop, Mathem, Unikum, InfoMentor, Trafiklab (nästa buss), hembatterier.

## Tack

Kopplingarna bygger på kartläggning från andra öppna projekt: [ha-ica-todo](https://github.com/lazytarget/ha-ica-todo) (ICA), [willys-mcp](https://github.com/oscarthroedsson/willys-mcp) (Willys/Axfood), [Waste Collection Schedule](https://github.com/mampfes/hacs_waste_collection_schedule) (EDP Future-renhållare och SRV Återvinning – en veckovis koll larmar om deras kod eller tjänsten ändras), [Vklass scrape sensor](https://community.home-assistant.io/t/vklass-scrape-sensor/939402), [node-schoolsoft](https://github.com/CarelessInternet/node-schoolsoft) (SchoolSoft) och [Skolmat](https://github.com/Kaptensanders/skolmat) (skolmaten.se). Elpris från [elprisetjustnu.se](https://www.elprisetjustnu.se), väder från [Open-Meteo](https://open-meteo.com), postnummer från [OpenStreetMap Nominatim](https://nominatim.org).

## Licens

MIT
