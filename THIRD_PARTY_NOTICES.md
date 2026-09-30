# Mitgelieferte Bibliotheken

Die Dateien in `vendor/` stammen von Dritten und stehen unter deren Lizenz, nicht unter der Lizenz dieses Projekts.

| Datei | Projekt | Lizenz |
|---|---|---|
| `vendor/three.min.js` | [three.js](https://github.com/mrdoob/three.js) r128 | MIT, Copyright © 2010–2021 three.js authors |
| `vendor/OrbitControls.js` | three.js (examples/js) r128 | MIT, Copyright © 2010–2021 three.js authors |
| `vendor/fflate.min.js` | [fflate](https://github.com/101arrowz/fflate) 0.8.2 | MIT, Copyright © Arjun Barrett |
| `vendor/mpegts.min.js` | [mpegts.js](https://github.com/xqq/mpegts.js) 1.8.2 (Nachfolger von flv.js) | Apache-2.0, Copyright © Bilibili, xqq; Lizenztext in `vendor/mpegts.js-LICENSE.txt` |

Vom Server genutzte Python-Pakete (`requirements.txt`, im Container installiert, nicht mitgeliefert):

| Paket | Lizenz |
|---|---|
| [paho-mqtt](https://github.com/eclipse-paho/paho.mqtt.python) 2.1.0 | EPL-2.0 / EDL-1.0 |
| [cryptography](https://github.com/pyca/cryptography) | Apache-2.0 / BSD |

**Im Container-Image** (nicht im Repository): [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer) 2.4.2, AGPL-3.0, unverändert als offizielles Linux-AppImage heruntergeladen und entpackt; der Quelltext steht unter der verlinkten Adresse (Tag `v2.4.2`). Der Konfigurator ruft Orca nur als eigenes Programm über die Kommandozeile auf.

Die Anbindung der Anycubic-Werksfirmware (`tools/anycubic_lan.py`) ist eigener Code nach der Protokollbeschreibung des Projekts [anycubic-lan](https://github.com/Nino6689/anycubic-lan) (docs/PROTOCOL.md, MIT, Copyright © 2026 Nino Bondonno); die ACE-Konfigurationswerte stammen aus der Dokumentation von [Rinkhals](https://github.com/rinkhals-community/Rinkhals). Hochladen und Druckstart folgen den beobachteten Abläufen in [kobra-connect](https://github.com/rvanderp3/kobra-connect) (docs/mqtt-commands.md, Apache-2.0) und [anycubic-orca-plugin](https://github.com/ianloic/anycubic-orca-plugin) (AGPL-3.0; nur Protokollfakten übernommen, kein Code).

**Schrift für die Beschriftung** (`js/font-hershey.js`): Hershey Simplex Roman, Zeichen 32–126 aus `futural.jhf` des Projekts [hershey-fonts](https://github.com/kamalmostafa/hershey-fonts) (nur die Schriftdaten, nicht der GPL-Code des Projekts); Ä Ö Ü ä ö ü ß € ° sind eigene Ergänzungen im Stil der Schrift. Die Hershey-Schriften gelten allgemein als gemeinfrei; ihre Weitergabebedingungen erlauben jede Nutzung, auch kommerziell, sofern folgende Hinweise mitgeliefert werden (und die Daten nicht im NTIS-Format weitergegeben werden):

> The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards.
> The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt).

## MIT-Lizenz (Wortlaut)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
