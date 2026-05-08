# Backgammon (Alpha)

Eine schlanke, abhängigkeitsfreie Backgammon-Web-App auf Deutsch
mit NPC-Gegner, weichen Animationen und nachvollziehbarem Zug-Verlauf.

Stack: reines HTML / CSS / JavaScript – keine Build-Tools, keine Frameworks.
Direkt auf GitHub Pages hostbar.

## Features

- **Klassisches Backgammon** mit Standardaufstellung (15 Steine pro Seite).
- **NPC-Gegner** in zwei Stufen (leicht / mittel) – Heuristik mit Pip-Count,
  Blot-Strafen, Punkte, Primes, Bar-Spiel.
- **Lokal-Modus** für 2 Spieler am selben Gerät.
- **Verlauf-Panel**: jeder Würfel- und Zugschritt wird mit kurzer
  Begründung („schlägt Blot auf 23", „macht Punkt 5", „würfelt aus") protokolliert –
  besonders für die NPC-Züge transparent.
- **Weiche Animationen** (FLIP-Technik) für Steinbewegungen,
  Würfelroll-Animation, sanfte Highlights für Zielfelder.
- **Bar / Bear-off** vollständig unterstützt, inkl. Bar-Wiedereintritt
  und Bear-off-Regeln (exakter Wurf oder höherer für entferntesten Stein).
- **Pasch / Doppelpasch** = vier Würfel.
- **„Großen Würfel zuerst"-Regel**, falls nur einer der beiden spielbar ist.
- **Rückgängig** für versehentliche Klicks.
- **Responsive**: Laptop primär (Brett links, Sidebar rechts);
  unterhalb 900 px stapelt sich das Layout vertikal für Mobil.

## Lokales Ausprobieren

```bash
# Aus dem Projekt-Root:
npx http-server Backgammon -p 8087 -c-1
# dann http://localhost:8087 im Browser öffnen
```

Oder in VS Code mit Live Server, oder einfach `index.html` doppelklicken
(funktioniert ohne Server).

## Bedienung

1. Auf der Startseite Gegner wählen → **Spiel starten**.
2. Beim eigenen Zug auf **Werfen** klicken.
3. Einen eigenen Stein anklicken (markierte Steine sind ziehbar).
4. Auf ein hervorgehobenes Zielfeld klicken (grün = ziehen, rot = schlagen).
5. Nach beiden Würfeln endet der Zug automatisch; der NPC ist dran.
6. Bei „Kein Zug möglich" einfach **Zug beenden**.

## Bekannte Einschränkungen (Alpha)

- Kein Verdoppelungswürfel (Doubling Cube).
- Kein Match-Modus / mehrere Partien hintereinander mit Punktestand.
- Keine Sounds.
- Kein Online-Multiplayer.

## GitHub Pages – Deployment

Das Projekt ist statisch und enthält keinen Build-Schritt.

1. Repository auf GitHub anlegen (oder vorhandenes nutzen).
2. Inhalt von `Backgammon/` in den Root des Repos legen
   (oder den Ordner als gh-pages-Subpfad pushen).
3. In den Repository-Einstellungen → **Pages** → Branch `main` und
   Ordner `/` (root) wählen.
4. Nach 1–2 Minuten ist die App unter
   `https://<benutzer>.github.io/<repo>/` erreichbar.

Es gibt keinen Server-Code, alles läuft im Browser.

## Lizenz

Privatprojekt – noch keine offizielle Lizenz vergeben.
