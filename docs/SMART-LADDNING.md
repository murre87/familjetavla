# Smart laddning i Familjetavlan

Har du en smartstyrning som lägger en laddplan för elbilen (billigaste timmarna, solel, avgångstid)? Då kan Familjetavlan visa **planen** och låta alla i familjen välja **laddläge**, utan att du ställer in något. Det räcker att styrningen lägger två saker i Home Assistant.

## 1. Laddplan: en sensor

- Entitets-id börjar på `sensor.` och innehåller bilens namn, t.ex. `sensor.tesla_model_y_laddplan`.
- **Tillstånd:** en kort text som visas som status, t.ex. `Laddar nu`, `Planerad 01:15`, `Pausad`, `Ingen plan`.
- **Attribut `slots`** (obligatoriskt): en lista med laddblock.

```yaml
slots:
  - { start: "2026-10-24T23:45+02:00", end: "2026-10-25T00:45+02:00", kw: 11.0 }
  - { start: "2026-10-25T02:15+02:00", end: "2026-10-25T02:45+02:00", kw: 10.5 }
```

  `start` och `end` är ISO 8601 (helst med tidszon), `kw` är valfri.
- **Valfritt per block:** `soc_start` och `soc_end` (batteri i % före och efter blocket) – då visar tavlan "32 → 46 %" i stället för kWh.
- **Valfritt:** `morning_check` = `{ time: "06:00", soc: 50, min: 50 }` (batteriet planen ger vid ett morgonmål och golvet) – tavlan visar "✓ 50 % kl 06:00" eller en varning.
- **Valfria attribut:** `soc_after_plan` (batteri i % när planen är klar), `planned_kwh`, `source` (vem som planerat).

- **Valfritt: veckoschema.** Attributet `schedule` = sju rader `{ day: 0–6 (0 = måndag), time: "07:00", soc: 80, enabled: true }` (klar kl `time` med batteri `soc` %), och `schedule_car` = ett id som smartstyrningen vill ha tillbaka. Då visar tavlan schemat under **Laddschema** i Bil-fliken.
- **Valfritt: ändra schemat från tavlan.** En `input_text` (max 255 tecken) vars id innehåller `laddschema` (eller `charge_schedule`) och `kommando` (eller `command`). Tavlan skriver `{"car": <schedule_car>, "day": 0, "time": "07:00", "soc": 80, "enabled": true}` dit. Smartstyrningen ska spara raden som sitt eget schema (så att det slår igenom i dess egen app) och kvittera genom att tömma fältet.

## 2. Laddläge: en väljare

- En `select` eller `input_select` vars entitets-id innehåller `ladd` eller `charg` och bilens namn, t.ex. `input_select.tesla_model_y_laddlage`.
- Alternativen ska innehålla **automatik** (`Auto`), **ladda nu** (`Ladda nu`, `Charge now`, `Force` …) och **pausa** (`Pausa`, `Pause`, `Stop`, `Hold` …).
- **Viktigt:** att välja ett alternativ ska ge exakt samma överstyrning som smartstyrningens egen knapp. Tavlans laddknapp väljer bara `Ladda nu` respektive `Pausa`. Smartstyrningen läser väljaren och gör resten, och ska skriva tillbaka väljaren om överstyrningen ändras i dess egen app, så att alla visar samma läge.

## Hur tavlan hittar dem

Tavlan letar efter sensorer med attributet `slots` och väljare enligt ovan, och kopplar dem till bilen via namnet i entitets-id:t. Finns det bara en bil och ett par kopplas de utan namn. Vill du peka ut dem själv kan du sätta `plan` och `mode` på bilen i inställningarna (`entities.cars[].plan` och `.mode`).

## Vad man ser

Under **Bil**: laddplanen för de kommande 24 timmarna som ett band, blocken med tid och effekt, kWh och batterinivå efter planen, knapparna **Auto / Ladda nu / Pausa** och en stor **Starta laddning / Stoppa laddning**. På startsidan visas planen i bilens statusrad.

## Exempel: EnergyWizard

[EnergyWizard](https://profitalgos.com) publicerar `sensor.<bil>_laddplan` varje minut och har `input_select.<bil>_laddlage` (`Auto`, `Ladda nu`, `Pausa`). Ändringar i Home Assistant tillämpas som appens egna laddknappar inom några sekunder, och ändringar i appen syns i Home Assistant.

Gör du en integration för en annan smartstyrning? Följ avtalet ovan så fungerar den i Familjetavlan direkt.

## Auto för värme, varmvatten och spabad

Samma tanke gäller allt som styrs smart: det ska alltid finnas ett läge **Auto** = följer sitt eget schema, som smartstyrningen i Home Assistant bestämmer. Lägg en `input_select` eller `select` med **Auto** som första alternativ (t.ex. `Auto / Varm / Sänkt`) och lägg den som reglage på ett Hus-kort, så visas den som knappar. Att välja Auto lämnar tillbaka styrningen till smartstyrningen. EnergyWizard publicerar `input_select.energywizard_varme`, `…_varmvatten` och `…_spabad` på det sättet.
