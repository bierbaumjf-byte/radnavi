# Jan's super Fahrradnavi

Fahrrad-Routenplanung und Navigation entlang **ausgeschilderter Radrouten**,
sonst über ruhige, asphaltierte Nebenstrecken mit viel Natur. Läuft im
Browser – am PC und auf dem Android-Handy, aus derselben Quelle, ohne
App-Store.

---

## Schnellstart am PC

Doppelklick auf `start.cmd`, oder in PowerShell:

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Dann öffnet sich `http://localhost:8099`.

Ein kleiner Server ist nötig, weil Browser bei direkt geöffneten Dateien
(`file://`) sowohl die Programmteile als auch den Standortzugriff sperren.

## Auf dem Handy

**https://bierbaumjf-byte.github.io/radnavi/**

Im Chrome auf dem Handy öffnen, Menü → *Zum Startbildschirm hinzufügen*.
Danach startet die App wie eine normale App, im Vollbild, und funktioniert
auch ohne Empfang, wenn die Karten vorher geladen wurden.

Die Adresse muss **https** sein – sonst gibt Android den GPS-Zugriff nicht
frei. Deshalb liegt der Programmcode öffentlich auf GitHub Pages
(`github.com/bierbaumjf-byte/radnavi`). **Nur der Code**: die 422 Naviki-Wege
sind nicht dabei, die verraten Wohnort und Fahrgewohnheiten.

Die Wege kommen getrennt aufs Handy, über `RadNavi-Wege.geojson` in diesem
Ordner – der liegt in Google Drive und ist damit auf dem Handy schon da.
In der App: *Meine Wege* → **GPX/Dateien importieren** → die Datei auswählen.
Einmalig, danach liegen sie in der Datenbank des Handys.

**Die richtige Datei ist `RadNavi-Wege.geojson`** – darin stecken alle
428 Wege zurück bis Mai 2016. Nicht zu verwechseln mit
`naviki-bundle-00.json` im Download-Ordner: das ist die Rohdatei, die beim
Holen von Naviki heruntergeladen wurde, und sie enthält nur die ersten
**90** Wege. Seit 08.11.2026 nimmt die App auch diese Rohdatei an (vorher
brach sie mit „Keine Linie im GeoJSON gefunden" ab, weil darin keine
Linien stehen, sondern vollständige GPX-Dateien als Text) – nur bekommt
man damit eben nicht alles.

---

## Name und Startbild

Die App heißt **Jan's super Fahrradnavi** – im Browsertitel, auf dem
Handy-Startbildschirm und beim Start.

Beim Öffnen erscheint knapp zwei Sekunden ein Startbild mit dem Namen;
ein Tipp überspringt es. Voreingestellt ist der gezeichnete Radfahrer
(`icons/comic-radfahrer.svg`) – den sieht jeder, der den Link bekommt.

Unter *Einstellungen → Eigenes Startbild* lässt sich stattdessen ein
eigenes Foto wählen. Das landet **nicht** im Programmordner, sondern in
der Datenbank des Geräts (IndexedDB), und wird vor dem Speichern auf
900 Pixel Kantenlänge verkleinert. Grund: der Programmordner liegt
öffentlich auf GitHub, ein Foto darin wäre für jeden sichtbar und bliebe
auch nach dem Löschen in der Versionsgeschichte stehen. Der Preis dieser
Lösung: das Bild muss auf jedem Gerät einmal ausgewählt werden, und es
verschwindet, wenn man die Browserdaten löscht.

Zwei Fallen beim Zeichnen des SVG, beide nachgemessen:

- **XML-Kommentare vertragen keine doppelten Bindestriche.** Die üblichen
  Trennlinien `<!-- ----- -->` machen die Datei ungültig; sie lädt dann
  gar nicht und das Bild bleibt leer, ohne Fehlermeldung im Protokoll.
- **Eine CSS-Klasse im `<style>` schlägt das Attribut am Element.** Mit
  `class="linie"` und zusätzlich `stroke="blau"` gewinnt die Klasse –
  die Beine der Figur waren dadurch rahmengrün und unsichtbar. Deshalb
  haben die Gliedmaßen eine eigene Klasse ohne `stroke`.

---

## Rundtouren

BRouter kennt keine Rundtouren, man muss ihm Zwischenziele vorgeben. Wo
die liegen, entscheidet alles.

**Vorher** lagen sie sternförmig *um* den Start herum. Der erste und der
letzte Schenkel führten damit radial hinein und hinaus – fast immer über
dieselbe Straße. Nachgemessen an einem 40-km-Vorschlag: **78 % der Strecke
wurden zweimal gefahren**, 7,5 km davon am Stück. Das war keine Rundtour,
das war eine Hin-und-Zurück-Fahrt mit einer Ausbuchtung.

**Jetzt** liegt der Start selbst auf dem Kreis: der Mittelpunkt ist um den
Radius in Fahrtrichtung verschoben, die Zwischenziele verteilen sich
gleichmäßig darauf. Die Tour ist ein Vieleck, das durch den Start läuft,
und hat keinen Schenkel, der zweimal benutzt werden müsste. Probiert
werden Vier-, Sechs- und Fünfeck, in dieser Reihenfolge – das Viereck lief
in der Messung am saubersten.

Bleibt doch eine Stichfahrt übrig, liegt das meist an einem einzelnen
Zwischenziel, das in einer Sackgasse gelandet ist. Die App findet es
(an der Stelle, wo das doppelt gefahrene Stück liegt) und schiebt es
seitlich auf dem Kreis weiter – einmal nach links, einmal nach rechts.

**Länge:** es wird nach unten abgerundet. Von allen Vorschlägen, die
sauber sind, gewinnt der längste, der die Wunschlänge *nicht* überschreitet.
Lieber 38,8 km als 42 km, wenn 40 gewünscht war.

**Was unter jedem Vorschlag steht:** Länge, Himmelsrichtung, Höhenmeter,
Anteil Ortslage und – das Entscheidende – wie viel am Stück doppelt
gefahren wird. Bis 600 m gilt als sauber (das sind Kreuzungen und die
Ausfahrt aus der eigenen Straße), darüber steht eine Warnung.

Messung vom 08.11.2026, 40 km gewünscht, Start in Bocholt, vier Richtungen:

| Vorschlag | Länge | doppelt am Stück | Ortslage |
|---|---|---|---|
| Südosten    | 38,8 km | 30 m  | 16 % |
| Südwesten   | 31,0 km | 520 m | 18 % |
| Nordosten   | 39,7 km | 1,9 km ⚠ | 13 % |
| Nordwesten  | 34,4 km | 850 m ⚠ | 16 % |

Die Suche braucht dafür bis zu 18 Anfragen an den Routing-Server und
dauert eine knappe Minute. Der Zähler in der Ergebnisliste zeigt, dass
noch etwas passiert.

---

## Die Routenberechnung

Gerechnet wird mit [BRouter](https://brouter.de) und einem eigenen Profil,
`profiles/naturroute.brf`. Es ist vom BRouter-Trekking-Profil abgeleitet und
an den entscheidenden Stellen umgebaut:

| Was | Wie |
|---|---|
| Ausgeschilderte Radrouten | Wege, die zu einem Radroutennetz gehören (`route_bicycle_icn/ncn/rcn/lcn` aus Relationen, dazu `lcn=yes` am Weg), kosten **nichts extra**. Fahrradstraßen und als Radweg ausgewiesene Wege einen kleinen Zuschlag, alles übrige den vollen. |
| Wenig Lärm | `estimated_noise_class` wird stark verteuert. Ein Radweg neben einer lauten Straße erbt deren Lärmklasse – genau deshalb wirkt dieser Hebel gegen Begleitradwege. |
| Wenig Verkehr | `estimated_traffic_class` 4–7 wird teuer. Fehlt die Klasse, gibt es **keinen** Aufschlag: abseits der Hauptstraßen ist sie schlicht nicht gesetzt. |
| Viel Natur | `estimated_forest_class` senkt die Kosten; Wege ohne Grün bekommen einen Aufschlag. |
| Nebenstraßen | `highway=unclassified` ist mit Kostenfaktor 1,0 die **günstigste** Straßenklasse – der Wirtschaftsweg und die Nebenstraße. |
| Radwege an Autostraßen | Anders als im Trekking-Profil gibt ein begleitender Radweg auf Haupt- und Landstraßen **keinen** großen Rabatt. Zusätzlich kostet ein radwegartiger Weg mit hoher Lärmklasse das Fünffache extra. Verboten ist er nicht – für kurze Lückenschlüsse bleibt er wählbar. Wie lang das längste solche Stück tatsächlich geworden ist, steht unter der Route. |
| Asphalt | Unbefestigtes bekommt einen festen Aufschlag, Kopfsteinpflaster einen kleineren. |

Die Regler unter **Feinabstimmung** schreiben diese Werte um. Die App lädt das
geänderte Profil dann zum Routing-Server hoch und merkt sich dessen Kennung,
damit derselbe Text nicht zweimal hochgeladen wird. Das gilt überall gleich –
auch für die Rundtouren: dort wird nichts zusätzlich verstellt.

### Der Regler „Ortskerne umfahren“

Der hat eine Schwelle, die man kennen muss. Nachgemessen am 08.11.2026,
Telgte → Nottuln, sonst gleiche Einstellungen:

| Regler | Länge | Ortslage | auf Radrouten |
|---|---|---|---|
| 0   | 39,5 km | 21 % | – |
| 1,5 | 39,7 km | 20 % | 90 % |
| 2,5 | 51,7 km |  5 % | 95 % |
| 4,0 | 51,7 km |  5 % | 95 % |

Unterhalb von etwa 2 passiert praktisch nichts: der kürzere Weg durch den
Ort gewinnt trotzdem. Ab 2,5 kippt es, und dann deutlich – auf dieser
Strecke kostet die Ortsumfahrung **12 km Umweg**. Dafür steigt der Anteil
auf ausgeschilderten Radrouten von 90 auf 95 %.

Deshalb steht die Voreinstellung jetzt auf 2,5 (streng: 3,5). Wer lieber
den direkten Weg durch die Orte nimmt, zieht den Regler unter 2 – diese
Wahl bleibt dann erhalten.

### Der Regler „Asphalt statt Schotter“

Der hat bis zum 08.11.2026 nur halb gewirkt, und das war ein echter Fehler.

Er hing an `isunpaved`, und das zählt in BRouter nur, was **ausdrücklich**
als unbefestigt getaggt ist (`surface=gravel`, `ground`, `earth` …). Ein
`highway=path` oder `track` **ohne** `surface`-Angabe – also der normale
Wald- und Feldweg in OpenStreetMap – galt damit als befestigt. Der Regler
sah ihn nicht. Hochgedreht wich die Route deshalb nicht auf die Straße aus,
sondern von den getaggten Erdwegen auf die **ungetaggten Pfade**.

Nachgemessen, Kapstadt, vier Punkte, sonst gleiche Einstellungen:

| Regler | Pfade ohne Belagsangabe |
|---|---|
| 0   | 2.234 m |
| 8 (Maximum) | **4.806 m** |

Der Regler machte es also schlimmer, nicht besser.

Seit 08.11.2026 gilt ein `path`, `track`, `bridleway` oder `road` ohne
Belagsangabe als unbefestigt (`probablyUnpaved`), und der Zuschlag wird mit
2,5 multipliziert – beim Maximum also 20. Das muss so hoch sein, weil der
Zuschlag *addiert* wird und gegen Lärm- und Ortszuschläge von 5 bis 8
bestehen muss. `footway` und `cycleway` bleiben außen vor: die sind ohne
Angabe meistens befestigt.

Vorher/nachher, Regler jeweils auf Maximum, Anteil **nicht** asphaltiert:

| Strecke | alt | neu | Länge alt → neu |
|---|---|---|---|
| Kapstadt, 4 Punkte | 19,6 % | **6,2 %** | 41,5 → 41,2 km |
| Bocholt → Winterswijk | 16,0 % | **0,9 %** | 21,5 → 22,0 km |
| Borken → Hohe Mark | 8,1 % | **0,6 %** | 34,3 → 39,8 km |

Der Preis steht in der letzten Spalte: im Waldgebiet kostet der Asphalt
16 % Umweg. Das ist kein Fehler, das ist die Entscheidung.

#### Wo die Voreinstellung jetzt steht

Mit dem reparierten Regler war die alte Voreinstellung 2,0 zu niedrig.
Durchgemessen, Anteil **nicht** asphaltiert und Länge:

| Regler | Bocholt → Winterswijk | Borken → Hohe Mark |
|---|---|---|
| 2,0 | 18 % · 20,6 km | 5,1 % · 34,7 km |
| 3,0 | 8,7 % · 21,8 km | 5,1 % · 34,7 km |
| **4,5** | **0,9 % · 22,0 km** | **5,3 % · 35,0 km** |
| 8,0 | 0,9 % · 22,0 km | 0,6 % · 39,8 km |

Bei 4,5 ist in Bocholt der Boden erreicht – weiter hochdrehen bringt dort
nichts mehr. Im Waldgebiet kostet der Schritt von 4,5 auf 8,0 noch einmal
4,7 Prozentpunkte, aber **4,8 km Umweg**. Deshalb steht die Voreinstellung
jetzt auf **4,5**, „Radrouten streng" auf 6,5 (dort gemessen: 37,4 km,
4,9 % nicht asphaltiert – der Rest sind Wirtschaftswege, die selbst Teil
der ausgeschilderten Radroute sind).

Ein gespeicherter Wert unter 4,5 wird einmalig angehoben
(Einstellungs-Fassung 4), alle anderen Regler bleiben unangetastet. Wer
Schotter mag, zieht ihn zurück – das bleibt dann erhalten.

### Wenn die Route quer durchs Gelände oder übers Wasser läuft

**Drei** verschiedene Ursachen, die auf der Karte gleich aussahen – alle
drei als rote Linie, als wäre es eine Radstrecke:

1. **Ein echter Weg, nur ein schlechter.** Ein Wanderpfad ist in
   OpenStreetMap eine dünne gestrichelte Linie – auf der Karte kaum zu
   sehen, für BRouter ein ganz normaler Weg. Dagegen hilft der Regler oben.
2. **Fährlinie.** Fähren sind erlaubt (`allow_ferries`), und am Rhein ist
   das Gold wert. In der Table Bay vor Kapstadt führte es dazu, dass
   **16,3 km von 21,2 km** auf Schiffslinien lagen.
3. **Luftlinie.** Liegt ein Punkt abseits jedes Weges, zieht BRouter eine
   schnurgerade Verbindung dorthin (`add_beeline`). Im selben Beispiel
   waren das noch einmal 4,2 km.

Gemessen, nicht geraten: `add_beeline = false` hilft übrigens **nicht**.
Die gerade Verbindung bleibt, nur der Hinweis darauf fällt weg – die
Einstellung steuert den Abbiegehinweis, nicht die Linie. Deshalb liegt
die Lösung in der App, nicht im Profil:

* Fährstrecken werden **blau gestrichelt** gezeichnet, Luftlinien **grau
  gepunktet**, beide mit weißem Untergrund, damit kein Rot durchblitzt.
  Eine Linie, die man nicht fahren kann, sieht jetzt auch nicht so aus.
* Unter der Route steht, wie viele Kilometer auf Fähre und Luftlinie
  entfallen.
* Belag, Lärm, Natur und Ortslage beziehen sich nur noch auf den **wirklich
  gefahrenen Teil**. Vorher galt eine Schiffspassage als „100 % befestigt“.
* Die App nennt die Streckenpunkte, die abseits jedes Weges liegen, mit
  Abstand – und bietet an, sie auf die nächste befahrbare Stelle zu ziehen.
  Achtung: das ist die nächste befahrbare Stelle *dieser Route*, nicht der
  nächste Weg überhaupt. Der Abstand steht dabei, damit man sieht, worauf
  man sich einlässt.
* Rundtour-Vorschläge mit Fähre oder Luftlinie fliegen aus der Auswahl,
  bevor Länge und Doppelungen überhaupt verglichen werden.

### Treppen, Fahrverbote und der Schalter „Nur befestigte Wege“

Auf Mallorca führte die App über Treppen. Die Ursache steckte in einer
einzigen Zeile des Profils:

```
assign costfactor
  …
  else min 9999   <die ganze Summe der Zuschläge>
```

BRouter schließt einen Weg erst ab Kosten **10000** aus. Das `min 9999`
deckelt aber die gesamte Summe darunter. Jede Sperre, die *innerhalb*
dieser Summe mit 10000 geschrieben war – Treppen, gesperrte Wege –, kam
als 9999 heraus: extrem teuer, aber eben erlaubt. Sobald es keine
billigere Verbindung gab, wurde sie genommen. Harte Verbote müssen
deshalb **vor** dem `min 9999` stehen, und genau dort stehen jetzt:

| Ausgeschlossen | Bedingung |
|---|---|
| Treppen | `highway=steps`, solange „Treppen erlauben“ aus ist |
| vollständig gesperrt | `accesspenalty > 9000` (weder Rad noch Fuß erlaubt) |
| nicht fahrbar | `bicycle=no`, `dismount`, `use_sidepath` |
| unbefestigt | `probablyUnpaved`, solange „Nur befestigte Wege“ an ist |

Der dritte Punkt war der stillere Fehler. `bicycle=dismount` heißt
„absteigen und schieben“, `bicycle=no` heißt „hier nicht fahren“ – beides
kostete über `accesspenalty` nur **4**, also fast nichts. Nachgemessen in
Palma, Kathedrale zur Plaça Major: 0,78 km mit 15 m Treppe und 48 m
Schiebestrecke mitten drin. Jetzt 1,08 km, beides null. Die 300 m Umweg
sind der Preis, und er ist richtig.

Neu ist der Schalter **„Nur befestigte Wege“** (Feinabstimmung,
voreingestellt an). Er verbietet, was der Regler „Asphalt statt Schotter“
bisher nur verteuert hat. Gemessen Bocholt → Winterswijk: 125 m Feinschotter
verschwinden, die Route wird dabei 10 m länger. Wer über Feldwege will,
schaltet ihn ab; die Einstellung bleibt erhalten.

**Was ausdrücklich *nicht* gesperrt wird:** `access=no` allein. Die
Auffahrt zum Castell de Bellver in Palma trägt `access=no foot=yes
bicycle=yes` – für Autos gesperrt, fürs Rad frei. Solche Park- und
Forstwege sind oft die schönsten Stücke. Entscheidend ist, was für das
*Fahrrad* gilt, nicht was für Autos gilt.

**Ein Versuch, der schiefging** – damit ihn niemand wiederholt: der
Zuschlag für nur-zu-Fuß-erlaubte Wege von 4 auf 10 zu heben klingt
naheliegend, kippt aber ganze Routen. Palma → Valldemossa fiel damit von
26,15 km über ruhige Nebenstraßen (30 % tertiary, 13 % ausgeschilderte
Radroute) auf 19,65 km mit 28 % Landstraße und 6,6 % Bundesstraße. Ein
kurzes fußrechtliches Stück hält dort die ganze ruhige Kette zusammen.
Der Wert steht wieder auf 4.

Wenn die einzige Verbindung an einer dieser Sperren hängt, meldet die App
„Keine Verbindung gefunden“ und nennt die beiden Schalter, mit denen man
sie wieder öffnet.

### Was die Route tatsächlich geworden ist

Unter jeder Route steht, wie viel Prozent befestigt sind und wie viel durch
Wald und Grün führt, dazu Warnungen bei Haupt­straßen­anteilen oder lauten
Abschnitten. Das ist wichtiger, als es aussieht: wenn in einer Gegend keine
stille Verbindung existiert, sagt die App das, statt eine schöne Zahl zu
behaupten.

Bei den Serverprofilen (Trekking, Schnell, Kürzeste) fehlen die Lärm- und
Naturangaben. Das ist kein Fehler: BRouter liefert nur die Kartenmerkmale
zurück, die das benutzte Profil auch auswertet.

### Gemessener Vergleich

Zwei feste Punktepaare, mehrfach nachgerechnet:

**Telgte → Nottuln**

| Profil | Strecke | auf Radroute | befestigt | Hauptstraße | längster Begleitradweg |
|---|---|---|---|---|---|
| Radrouten-Naturroute | 39,3 km | **89 %** | 91 % | 130 m | 191 m |
| Radrouten streng | 40,8 km | **91 %** | 92 % | 130 m | 149 m |
| ohne Radroutenpflicht (Stand 07.11.) | 39,1 km | 81 % | 93 % | 0 m | 191 m |
| Trekking | 33,3 km | – | 100 % | 4 % | – |
| Kürzeste | 32,6 km | – | 48 % | 27 % | – |

**Bocholt → Münster**

| Profil | Strecke | auf Radroute | befestigt | längster Begleitradweg |
|---|---|---|---|---|
| Radrouten-Naturroute | 94,1 km | **92 %** | 89 % | 882 m |
| ohne Radroutenpflicht | 90,4 km | 74 % | 97 % | 586 m |

Die Radroutenpflicht kostet also auf der langen Strecke rund 4 % Umweg und
8 Punkte Asphalt, bringt dafür 18 Punkte mehr ausgeschilderte Strecke.

---

## Funktionen

**Planen**
- Punkte durch Tippen in die Karte oder über die Adresssuche
- Zwischenziele beliebig viele, verschiebbar (▲ ▼ oder Ziehen), einzeln löschbar
- Marken lassen sich auf der Karte direkt verschieben, die Route rechnet nach
- Bis zu drei Varianten je Berechnung
- Höhenprofil mit Fadenkreuz; der Punkt wandert dabei über die Karte
- Rundtouren: Startpunkt und Wunschlänge angeben, vier Richtungen werden
  vorgeschlagen – echte Runden ohne Umkehren, nie länger als gewünscht
  (siehe eigenen Abschnitt weiter unten)

**Unterwegs**
- Sprachansagen in zwei Stufen (Vorwarnung und direkt vor der Abbiegung)
- Cockpit mit Tempo, Restkilometern, Ankunftszeit und Schnitt
- Automatische Neuberechnung nach einstellbarer Abweichung
- Bildschirm bleibt an (Wake Lock)
- Statt Straßennamen zeigt die App Wegart und Oberfläche an – BRouter kennt
  keine Straßennamen, Wegart und Belag sind für diesen Zweck ohnehin
  aussagekräftiger

**Meine Wege**
- Die alten Naviki-Wege sind übernommen – siehe unten
- Import von GPX, GeoJSON, KML und TCX, auch per Datei-Ziehen aufs Fenster
- Jeder Weg: auf der Karte zeigen, navigieren, in die Planung übernehmen
  (dann mit dem eigenen Profil neu rechnen), umbenennen, als GPX sichern, löschen
- Eigene Fahrten aufzeichnen und speichern
- Alles zusammen als eine GPX-Datei ausgeben

**Karten**
- OpenStreetMap als Voreinstellung – dieselbe Karte, die auch Naviki
  unter „OpenStreetMap" anbietet (`tile.openstreetmap.org`)
- dazu CyclOSM, OpenTopoMap, kontrastreich
- **Luftbild (Google)** – Googles Hybrid-Kachel, Satellitenbild mit
  Straßennamen darin, bis Zoomstufe 20
- **Luftbild (Esri)** – dasselbe in frei nutzbar, mit einer eigenen
  Beschriftungsebene darüber. Ausweichmöglichkeit, siehe unten
- Die Route ist eine **rote** Linie mit weißem Rand, Varianten grau gestrichelt
- Radrouten-Überlagerung (Waymarked Trails)
- Nachtmodus, folgt sonst der Systemeinstellung
- Kacheln der geplanten Route offline vorhalten

Alles bleibt auf dem Gerät: Wege in IndexedDB, Einstellungen im lokalen
Speicher. Es gibt kein Konto und keinen Server, der mitliest.

---

## Die Wege aus Naviki

Am 08.11.2026 sind **422 Wege aus dem Naviki-Konto geholt** worden, von der
ersten Dolomitentour im Mai 2016 bis zur Rennradrunde auf Mallorca Ende
Oktober 2026. Sie liegen als GPX im Ordner `naviki-export/` und sind in der
App bereits übernommen: 428 Strecken (sechs Dateien enthielten zwei
Teilstrecken), zusammen rund 22.350 km.

Naviki hat keinen Sammelexport. Die Wege sind deshalb einzeln über dieselbe
Schnittstelle geholt worden, die auch der Herunterladen-Knopf auf der
Naviki-Seite benutzt (`Util/wayToFileWithUser`, ein GPX je Weg).

Das Datum eines importierten Weges ist der **Zeitstempel aus der Datei**,
nicht der Tag des Imports – sonst stünde bei allen 422 derselbe Tag und die
Sortierung „Neueste zuerst“ wäre wertlos.

Liegt `naviki-export/index.json` neben der App, erscheint unter *Meine Wege*
ein Knopf, der die noch fehlenden Dateien einliest. Jeder Weg merkt sich
seinen Dateinamen, ein zweiter Durchlauf legt also nichts doppelt an. Ist
alles übernommen, verschwindet der Knopf von selbst.

Der Ordner ist mit rund 92 MB der mit Abstand größte Teil des Projekts und
wird nur einmal gebraucht. Beim Hochladen auf einen Webspace fürs Handy
gehört er **nicht mit dazu** – die Wege liegen dann längst in der Datenbank
des Browsers. Der Service Worker hält ihn aus demselben Grund aus dem
Offline-Speicher heraus.

---

## Dateien

```
index.html              Aufbau der Oberfläche
css/app.css             Darstellung, Hell und Dunkel, Handy und PC
js/app.js               Verdrahtung, Abläufe, Oberflächenlogik
js/map.js               Leaflet: Kartenebenen, Marken, Linien
js/router.js            BRouter: Profil erzeugen, hochladen, Route holen
js/geo.js               Rechnen auf der Kugel, Formatierung
js/nav.js               GPS, Navigation, Ansagen, Aufzeichnung
js/gpx.js               Dateien lesen und schreiben
js/geocode.js           Adresssuche (Nominatim)
js/elev.js              Höhenprofil
js/store.js             IndexedDB und Einstellungen
sw.js                   Offline-Betrieb
profiles/naturroute.brf Das Routing-Profil im Klartext
naviki-export/          Die 422 Wege aus Naviki, einmalige Übernahme
serve.ps1               Kleiner Server für den PC
```

Keine Abhängigkeiten außer Leaflet, das von einem CDN mit festgenagelter
Version und Prüfsumme geladen und offline vorgehalten wird.

---

## Fremde Dienste und ihre Grenzen

- **brouter.de** – Routing und Profil-Upload. Gemeinschaftsdienst, keine
  Garantie. Unter *Einstellungen → Routing-Server* austauschbar, etwa gegen
  einen selbst betriebenen BRouter.
- **nominatim.openstreetmap.org** – Adresssuche, höchstens eine Anfrage je
  Sekunde. Die App hält das ein und merkt sich Ergebnisse.
- **Kachelserver** – ebenfalls Gemeinschaftsdienste. Das Vorhalten ganzer
  Regionen ist nicht vorgesehen; die App lädt nur den Korridor entlang der
  geplanten Route.
- **mt0–mt3.google.com** – Googles Luftbild. Siehe unten.
- **server.arcgisonline.com** – das zweite Luftbild und seine Beschriftung.
  Esri stellt diese Ebene frei zur Verfügung, solange die Herkunft genannt
  wird; sie steht unten rechts in der Karte.

---

## Grenzen, ehrlich benannt

- **Das Google-Luftbild hängt an einer Adresse, die dafür nicht gedacht
  ist.** `mt0–mt3.google.com/vt?lyrs=y` ist die Schnittstelle, aus der
  Google Maps selbst seine Kacheln holt. Sie ist nicht dokumentiert, nicht
  zugesagt und laut Nutzungsbedingungen fremden Karten nicht erlaubt.
  Dreierlei kann daraus folgen: die Adresse ändert sich und die Karte
  bleibt leer; Google sperrt den Abruf; oder jemand bei Google stört sich
  an dem öffentlichen Repo. Nichts davon ist wahrscheinlich bei zwei
  Nutzern, möglich ist es. Auf ausdrücklichen Wunsch so gebaut.
  Darum steht **Luftbild (Esri)** gleich darunter im Menü – rechtlich
  sauber, in Deutschland oft aus denselben Befliegungen, einen Fingertipp
  entfernt, falls Google eines Tages nichts mehr liefert.

- **„Nur ausgeschilderte Radrouten" geht nicht als Verbot.** Von der
  Haustür bis zum nächsten ausgeschilderten Weg führt fast immer ein
  Stück gewöhnliche Straße; ein hartes Verbot würde die Berechnung
  scheitern lassen. Stattdessen ein Zuschlag, der groß genug ist, dass
  die Route Umwege bis etwa zum Vierfachen in Kauf nimmt, um aufs Netz
  zu kommen. In der Messung bleiben 8–9 % übrig – im Wesentlichen die
  ersten und letzten Kilometer.
- **Die Ein-Kilometer-Grenze für Begleitradwege lässt sich nicht
  erzwingen.** Das Kostenmodell bewertet jeden Wegabschnitt für sich und
  weiß nicht, wie lang das Stück am Stück schon ist. Die App rechnet die
  Grenze deshalb an der fertigen Route nach und schreibt das längste
  Stück darunter – über einem Kilometer mit Warnung. Gemessen wurden
  bisher 149 bis 882 m.
- **Keine Straßennamen in den Ansagen.** BRouter liefert sie nicht mit.
- **Die Lärm- und Naturklassen sind Schätzungen** aus der OSM-Umgebung, keine
  Messwerte. Sie fehlen auf vielen ruhigen Wegen schlicht – was in der Praxis
  selbst eine Aussage ist, aber kein Beweis.
- **Rundtouren bleiben unter der Wunschlänge, treffen sie aber nicht genau.**
  Das ist Absicht: abgerundet statt aufgerundet. Wie weit darunter, hängt
  vom Wegenetz ab – im Test 38,8 km bei 40 km gewünscht. Liegt der beste
  Vorschlag unter 80 % der Wunschlänge, steht ein Hinweis darüber.
- **„Ohne Umkehren" heißt nicht „garantiert kreuzungsfrei".** Gemessen wird
  das längste Stück, das zweimal in einem Umkreis von 25 m befahren wird;
  bis 600 m gilt das als Kreuzung oder Ausfahrt. Findet das Wegenetz keine
  saubere Runde, zeigt die App sie trotzdem – mit der Zahl daneben, statt
  gar nichts anzubieten.
- **Ortslage lässt sich nicht wegzaubern, wenn der Start in der Stadt liegt.**
  Bei einer Runde ab Bocholt entfallen die 8–16 % Ortslage fast vollständig
  auf das Hinaus- und Hereinfahren. Nachgemessen: die Ortsstücke lagen bei
  km 0–0,9 und km 40,9–49,2, dazwischen nichts.
- **Offline-Karten brauchen Vorbereitung.** Ohne vorher geladene Kacheln zeigt
  die Karte ohne Netz graue Flächen; Route, Ansagen und Aufzeichnung laufen
  weiter.
- **Routing braucht Netz.** Eine schon berechnete Route lässt sich offline
  abfahren, eine neue nicht berechnen.
