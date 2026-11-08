# Jans Super Fahrrad Navi

Fahrrad-Routenplanung und Navigation im Browser – am PC und auf dem Handy,
aus derselben Quelle, ohne App-Store.

Routen laufen vorrangig über **offiziell ausgeschilderte Radrouten**, sonst
über ruhige, asphaltierte Nebenstraßen mit wenig Verkehr, wenig Lärm und viel
Natur. Radwege unmittelbar neben Autostraßen werden stark verteuert und
sollen nur kurze Lückenschlüsse sein; wie lang das längste solche Stück
tatsächlich geworden ist, steht unter jeder Route.

## Was drin ist

- Ziele und Zwischenziele per Kartentipp oder Adresssuche, verschiebbar
- Bis zu drei Varianten, Höhenprofil, Rundtouren
- Sprachnavigation mit Vorwarnung und automatischer Neuberechnung
- Fahrtaufzeichnung, Import und Export von GPX, GeoJSON, KML, TCX
- Offline-Karten entlang der geplanten Route
- Alles bleibt auf dem Gerät: kein Konto, kein Server, der mitliest

## Technik

Reine statische Dateien, keine Bauwerkzeuge. Leaflet für die Karte,
[BRouter](https://brouter.de) fürs Routing mit einem eigenen Profil
(`profiles/naturroute.brf`), Nominatim für die Adresssuche,
OpenStreetMap-Kacheln für die Darstellung.

## Lokal starten

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Ein kleiner Server ist nötig, weil Browser bei direkt geöffneten Dateien
(`file://`) sowohl die Programmteile als auch den Standortzugriff sperren.

## Lizenz der Daten

Kartendaten © OpenStreetMap-Mitwirkende, ODbL.
