# TE Notes – Dein digitales Arbeitsgedächtnis

Eine Marke von **TE Digital**. Persönliches digitales Notizbuch als installierbare Progressive Web App (PWA) für iPad, PC und Tablets.

- Alle Daten bleiben **ausschließlich auf dem jeweiligen Gerät** (IndexedDB über Dexie.js).
- Kein Backend, keine Benutzerkonten, keine Cloud, kein Tracking, keine Telemetrie, keine KI-Dienste.
- Nach der ersten Installation **vollständig offline** nutzbar (Service Worker mit Precache aller Programmdateien).

## Funktionsumfang

| Bereich | Inhalt |
| --- | --- |
| Dashboard | Begrüßung, Datum, Schnellanlage (Notiz, Handschrift), zuletzt bearbeitet, angeheftet, offene und überfällige Aufgaben, kürzlich archiviert, Sicherungs-Erinnerung |
| Notizen | Titel, Inhalt, Erstell-/Änderungsdatum, Kategorie, Tags, Ordner, Projekt, Anheften, Archivieren, Papierkorb. Editor mit Überschriften, Formatierungen, Aufzählungen, nummerierten Listen, Checklisten, Links, Tabellen, Bildern, Dateianhängen. Automatisches Speichern ohne Speichern-Button |
| Handschrift | Eigener Canvas-Editor: Apple Pencil mit Druck, Stiftfarben, Strichstärken, Textmarker, Radiergummi, Rückgängig/Wiederholen, Verschieben und Zoomen (Finger/Pinch, Mausrad, Strg+Mausrad), mehrseitig, Papierarten (liniert, kariert, gepunktet, blanko), Bilder einfügen/verschieben/skalieren, PDF-Seiten als Schreibunterlage, Vollbild (nur Seite + schwebende Kurzleiste mit Stift, Marker, Radierer, Rückgängig, neuer Seite; alle Werkzeuge einblendbar; Esc beendet). Striche werden als Vektordaten gespeichert |
| Handschriftliche Aufgaben | Aufgabenbereich unten auf der Seite (Kästchen + Schreiblinie je Zeile, antippen = abhaken). Bei „Neue Seite“ und beim Anlegen der nächsten Handschrift-Notiz werden offene, beschriebene Zeilen auf Wunsch samt Handschrift übernommen; an der alten Stelle zeigt ein blauer Pfeil „übertragen“ (antippen hebt das auf). So wandert jede Aufgabe genau einmal weiter |
| Pencil vs. Finger | Standard: Pencil schreibt, Finger verschiebt und zoomt. Umschaltbar („Mit Finger zeichnen“). Handballen-Erkennung: Fingereingaben werden ignoriert, während der Stift aufliegt |
| Aufgaben | Titel, Beschreibung, Fälligkeit, Priorität, Status (Offen, In Bearbeitung, Erledigt, Zurückgestellt), zugehörige Notiz, Projekt, Kategorie, Verantwortlich. Überfällige deutlich markiert, erledigte bleiben in der Historie |
| Projekte & Kategorien | Frei anlegbar und bearbeitbar; Projekte mit Beschreibung, Status, Farbe sowie zugeordneten Notizen, Besprechungen und Aufgaben |
| Suche | Lokale Volltextsuche (Wortindex) über Titel, Inhalte, Aufgaben, Tags, Kategorien, Projekte; Filter nach Zeitraum, Kategorie, Projekt, Typ, Status. Umlaut-tolerant (z. B. „muller“ findet „Müller“) |
| Datensicherung | Vollständiger Export/Import, Wiederherstellung, Import mit Konfliktprüfung (pro Eintrag wählbar), PDF- und Markdown-Export einzelner Notizen, Export einzelner Notizen als `.tenotes`, Markdown-Import, Handschrift als PDF (Vektor) oder PNG, Erinnerung an Sicherungen |
| Sicherheit | Optionale PIN-App-Sperre (PBKDF2-gehasht). **Ausdrücklich keine Verschlüsselung** – das wird in der App so kommuniziert |

## Installation auf dem iPad

Eine PWA muss **einmalig über HTTPS ausgeliefert** werden, damit Safari sie installieren kann. Dafür genügt ein beliebiger statischer Webspace (z. B. Firmen-Webserver, GitHub Pages, Netlify). Der Webspace liefert nur die Programmdateien aus dem Ordner `dist/` – er speichert und empfängt **keine Daten**.

1. `dist/` auf den statischen Webspace hochladen (beliebiger Unterordner möglich, alle Pfade sind relativ).
2. Auf dem iPad die Adresse in **Safari** öffnen.
3. Teilen-Symbol → **„Zum Home-Bildschirm“**.
4. TE Notes immer über das Symbol auf dem Home-Bildschirm öffnen.

Wichtig für iPadOS:

- Die installierte App und ein Safari-Tab haben **getrennte Datenbestände**. Immer die installierte App verwenden.
- Installierte Home-Bildschirm-Apps sind von Safaris automatischem Löschen nach Inaktivität ausgenommen. In einem normalen Safari-Tab kann Safari Daten nach längerer Nichtnutzung entfernen.
- **Updates kommen automatisch:** Jede Änderung auf `main` wird per GitHub Actions gebaut und auf GitHub Pages veröffentlicht. Die App sucht beim Öffnen, beim Zurückkehren in die App und alle 30 Minuten nach einer neuen Version und übernimmt sie, sobald die App in den Hintergrund geht (nie mitten im Schreiben). Über den Hinweis „Jetzt aktualisieren“ geht es sofort. Die Daten bleiben dabei auf dem Gerät; Datenbank-Migrationen laufen beim nächsten Start automatisch.

Auf Windows (Edge/Chrome) erscheint in der Adressleiste ein Installationssymbol. Für Tests genügt `http://localhost`.

## Datensicherung & Gerätewechsel

Es gibt **keine automatische Synchronisierung** zwischen iPad und PC. Jedes Gerät hat einen eigenen Datenbestand.

- **Einstellungen → Vollständige Sicherung** erzeugt eine `.tenotes`-Datei. Auf dem iPad „Teilen / In Dateien sichern“ wählen.
- **Einstellungen → Importieren** liest eine Sicherung ein. Vor dem Übernehmen zeigt TE Notes neue, identische und konfliktbehaftete Einträge. Optionen: zusammenführen (neuere Version gewinnt), nur neue hinzufügen, Sicherung bevorzugen oder vollständige Wiederherstellung.
- Die PIN der App-Sperre wird nicht mitgesichert.

### Sicherungsformat (Version 1)

ZIP-Datei mit Endung `.tenotes`:

```
manifest.json          Format, Formatversion, App-Version, DB-Schema, Zeitpunkt, Umfang, Anzahl
data/notes.json        Notizen (Metadaten)
data/bodies.json       Inhalte der Textnotizen (TipTap-JSON + Klartext)
data/inkPages.json     Handschrift-Seiten (Vektorstriche, Bildpositionen, Hintergrund)
data/tasks.json        Aufgaben
data/projects.json     Projekte
data/categories.json   Kategorien
data/folders.json      Ordner
data/settings.json     Einstellungen (ohne gerätespezifische Werte)
data/attachments.json  Metadaten der Anhänge
files/<id>             Binärdaten der Anhänge, Bilder und PDF-Hintergründe
```

Neuere Formatversionen werden beim Import erkannt; ältere werden über `migrateBackup()` angehoben. Besprechungen aus älteren Sicherungen werden dabei – wie in der Datenbank – in Textnotizen umgewandelt.

### Entfernte Besprechungsplanung (ab Version 1.1)

Die eigene Besprechungsfunktion ist entfallen. Datenbank-Schema 3 wandelt vorhandene Besprechungen verlustfrei in Textnotizen um: Datum, Ort, Thema und Teilnehmer stehen als Kopfzeilen am Anfang, Entscheidungen als nummerierte Liste am Ende, eine Wiedervorlage wird zur Aufgabe „Wiedervorlage: …“ mit Fälligkeitsdatum.

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Automatische Tests (Datenhaltung, Suche, Sicherung, Migration, Leistung, Markdown)
npm run build      # Produktionsbuild nach dist/
npm run preview    # Produktionsbuild lokal testen (http://localhost:4173)
npm run icons      # App-Symbole aus public/icons/icon.svg erzeugen
```

Technik: React 18, TypeScript, Vite, vite-plugin-pwa (Workbox), Dexie.js, TipTap, perfect-freehand, pdf.js, jsPDF, fflate.

Datenbank-Migrationen: In `src/db/db.ts` für jede Schemaänderung eine neue `this.version(n)` ergänzen. Bestehende Versionen nie ändern.

## Teststand

Automatisch geprüft (Vitest): Anlegen/Speichern/Suchen, Papierkorb und endgültiges Löschen, Archiv, Umbenennen von Kategorien im Suchindex, Aufgabenstatus, vollständige Sicherung und Wiederherstellung inklusive Binäranhängen und Handschrift, Konflikterkennung und Zusammenführung, Einzelnotiz-Export, Ablehnung ungültiger Dateien, Migration Schema 1 → 3 (Besprechungen → Textnotizen), Umwandlung alter Sicherungen, Übernahme handschriftlicher Aufgaben (Seite und nächste Notiz), 3000 Notizen, Markdown-Rundreise.

Im Browser (Chromium, Windows) geprüft: Notiz- und Besprechungserfassung mit Autosave, Wiederherstellung nach Neuladen, Tabellen und Checklisten, Aufgaben aus Notizen, Handschrift mit simulierten Pencil-Ereignissen (Druck, Textmarker, Radierer, Rückgängig, Finger-Verschieben, Pinch-Zoom, Seiten), PDF-Import, PDF-Export (Text und Vektor-Handschrift), PNG-Export, Sicherung/Import/Konflikte/Wiederherstellung, Suche, vollständiger Offlinebetrieb bei gestopptem Server, 2000 zusätzliche Notizen, Smartphone-Layout, Dunkelmodus, Update-Hinweis.

**Noch auf echter Hardware zu prüfen** (in dieser Umgebung nicht möglich):

- [ ] iPad Safari und installierte PWA auf iPadOS
- [ ] Apple Pencil: Druckstufen, Handballenauflage, Latenz
- [ ] Sicherung über „In Dateien sichern“ und Import aus der Dateien-App
- [ ] Große Handschrift-Notizen (z. B. 50+ Seiten, PDF mit 100 Seiten) auf dem iPad
- [ ] Verhalten nach Neustart des iPads und nach längerer Nichtnutzung
