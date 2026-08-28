# RallyCue

RallyCue unterstützt Badmintonturniere bei der Feldbelegung und bei automatischen Ansagen. Spieler lassen sich nach Altersklasse und Kategorie verwalten und per Drag-and-drop auf neun Felder verteilen.

## Funktionen

- Spieler für Jungen- und Mädchen-Einzel verwalten
- Nach Altersklasse, Kategorie und Name filtern
- Spieler per Drag-and-drop oder Klick einem Feld zuweisen
- Sicherheitsabfrage vor dem Überschreiben einer Belegung
- Deutsche Feldansagen mit einer lokal ausgeführten Piper-Stimme
- Lokale Speicherung der Turnierdaten im Browser

## Lokale Entwicklung

Vorausgesetzt werden Node.js 22.13 oder neuer und npm.

```bash
npm install
npm run dev
```

Der Produktions-Build wird mit `npm run build` erstellt.

## Datenschutz

Spieler und Feldbelegungen werden ausschließlich im lokalen Browserspeicher des jeweiligen Geräts abgelegt. RallyCue verwendet keine gemeinsame Turnierdatenbank.
