# SmartRepair Lager Online v4.5

Online-Lagerverwaltung für eine Handy-Reparaturwerkstatt.

## Funktionen

- Anmeldung mit Admin-Konto
- PostgreSQL-Datenbank
- Artikelverwaltung und datenbankgestützte Suche
- Wareneingang und Warenausgang mit Menge, Preis und Datum
- Kunden-/Grundangabe bei Ausgang
- Lieferantenverwaltung
- Bestellliste für Geschäft oder Kunde
- Kundenname und Telefonnummer
- Dashboard und Bewegungshistorie

## Deployment auf Render

1. Alle Dateien aus diesem Ordner in die Wurzel des GitHub-Repositories hochladen.
2. In Render: **New > Blueprint** auswählen.
3. Das GitHub-Repository `SmartRepairLager` verbinden.
4. Render erkennt die Datei `render.yaml`.
5. Bei `ADMIN_PASSWORD` ein sicheres Passwort eingeben.
6. Blueprint erstellen und auf den erfolgreichen Deploy warten.

## Anmeldung

- E-Mail: `ari@mohammadi.at`
- Passwort: der Wert, den du in Render bei `ADMIN_PASSWORD` festlegst.

## Wichtig zur kostenlosen Render-Datenbank

Die kostenlose Render-PostgreSQL-Datenbank ist nur zum Testen geeignet und läuft nach 30 Tagen ab. Für dauerhafte Geschäftsdaten später auf eine kostenpflichtige Datenbank wechseln oder regelmäßig exportieren.

## Sicherheit

Das Passwort niemals in GitHub-Dateien speichern. Es wird ausschließlich als geheime Environment Variable in Render gesetzt.

## v4.5 fix
Die Benutzeroberfläche ist zusätzlich direkt in `server.js` eingebettet. Dadurch funktioniert die Startseite auch dann, wenn der Ordner `public` beim GitHub-Upload fehlt.


## v4.5 Login-Fix
Beim Start wird das Admin-Konto mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` aus Render aktualisiert. Dadurch gilt nach jedem Deploy genau das in Render eingetragene Passwort.
