# RallyCue

RallyCue unterstützt Badmintonturniere bei der Feldbelegung und bei automatischen Ansagen. Spieler lassen sich nach Altersklasse und Kategorie verwalten und per Drag-and-drop auf neun Felder verteilen.

## Funktionen

- Spieler der Altersklassen U9 bis U19 für Jungen- und Mädchen-Einzel verwalten
- Nach Altersklasse, Kategorie und Name filtern
- Spieler per Drag-and-drop oder in beiden Klickrichtungen einem Feld zuweisen
- Sicherheitsabfrage vor dem Überschreiben einer Belegung
- Belegte Felder nach Bestätigung vollständig leeren
- Feste Piper-Stimme „Thorsten Emotional“ mit drei Geschwindigkeiten und Testansage
- Lokale Speicherung der Turnierdaten im Browser
- Lokale JSON-Sicherung und Wiederherstellung der Turnierdaten

## Lokale Entwicklung

Vorausgesetzt werden Node.js 22.13 oder neuer und npm.

```bash
npm install
npm run dev
```

Der Produktions-Build wird mit `npm run build` erstellt.

## GitHub Pages

Jeder Push auf `main` erstellt automatisch einen statischen, installierbaren Build und veröffentlicht ihn unter [pixeldogt.github.io/RallyCue](https://pixeldogt.github.io/RallyCue/). Für einen manuellen Pages-Build kann `npm run build:pages` verwendet werden.

## Datenschutz

Spieler und Feldbelegungen werden ausschließlich im lokalen Browserspeicher des jeweiligen Geräts abgelegt. RallyCue verwendet keine gemeinsame Turnierdatenbank.
