# Julkortet (Nordpol)

`nordpol-card.js` är **Nordpol Card v2.4.5** av DKAnord, oförändrad:
<https://github.com/DKAnord/nordpol-card> (commit `fb14164`, MIT-licens, se `NORDPOL-CARD-LICENSE`).
Det är ett julkort till Home Assistant med nedräkning, tomtekameror, släde, snällista och dagens tomte.

Kortet läser ett `hass`-objekt. Här får det ett litet eget skal (`hass.ts`) i stället för Home Assistant:
plats och tidszon, och snällistan sparas i tavlans egen fil (`server/src/julnice.ts`, `GET/POST /api/jul/nice`).

- Visas som standard 21 november – 26 december varje år; familjen kan välja "på" året runt eller "av"
  (Inställningar → Julkort, `dashboard.christmas`, se `server/src/christmas.ts`).
- Kamerorna är korta filmklipp som webbläsaren hämtar från kortets egen sida, `dkanord.github.io/nordpol-card/media`.
  Allt annat stannar i tavlan.
- Byte av version: ersätt `nordpol-card.js`, uppdatera versionen här och prova fliken Jul.
