# Roadmap

Vad som är beslutat, vad som väntar och vad som medvetet inte görs. Uppdateras när något beslutas.
Önskemål kommer i [issues](https://github.com/murre87/familjetavla/issues).

## Beslut

- **Licens: AGPL-3.0, beslutat 2026-11-08** (samma som EnergyWizard). Versioner till och med 0.27.0 släpptes under MIT och gäller fortfarande under MIT.
- **Ny design (platt) är standard sedan 0.20.0.** Klassisk finns kvar och ändras inte. Stående läge på surfplatta stöds inte i nya designen (beslut 2026-11-04, tillsvidare).
- **Läsbar text före att allt syns (2026-11-06–08).** Veckan, kalendern, personvyn och alla flikar och sidor krymper inte längre för att få plats: de rullar i full storlek. Textstorleken ställs per ruta och per sida med kugghjulet, per skärm.
- **Startsidan byggs som ett pussel (0.24.0).** Per skärm under *Ordna startsidan*. Standarden är den gamla layouten.
- **Engelska: inte nu (2026-11-08).** Två av arton issues från andra var på engelska, båda från samma person i Sverige, och tavlan bygger på svenska tjänster (Vklass, SchoolSoft, Skolmat, svenska renhållare och lov). Tas upp igen om fler frågar. Då görs det som i EnergyWizard: en fil per språk med `"svensk text": "översättning"`, så att det kan översättas lite i taget (#35).
- **Nya issues får tack och sponsringsönskan automatiskt** (`.github/workflows/sponsring-nya-issues.yml`, samma text som 2026-11-06).
- **Släpp:** ändringslogg och version i PR, tagg först när CI är grön på main, Home Assistant-tillägget höjs av release-jobbet.


## Väntar på svar från den som frågade

- Tyra (#28): adresserna (URL:erna) som laddar schemat, utan lösenord.
- Sökbara rullistor (#40): vilken lista som saknar sök.
- Uppdateringsfel i Home Assistant (#44): Supervisor-loggen.
- Skolmat.info (#50): används Home Assistant?
- Keba P30 (#62): vilka entiteter integrationen ger.

## Önskemål, inte påbörjade

- Homey som källa för prylar bredvid Home Assistant (#33) – behöver någon med Homey Pro som kan testa.
- Månadsvy i kalendern (kalendern bläddrar vecka för vecka åtta veckor fram sedan 0.23.0) (#37).
- Laddschema på Bil-fliken (PR #38) – skriver schema och automation i Home Assistant och överlappar EnergyWizards laddplan. Emil avgör.
- Ur `docs/PROJEKT.md` (medvetet utskjutet): effektvakt, värme efter elpris, notiser för maskiner, flera tavlor med olika vyer, en HACS-integration som visar tavlans data som entiteter.
