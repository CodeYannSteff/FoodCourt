# Implementare final — drum spre lansare

Muncho · Food Court Argeș Mall · Pizzeria Sapori Italia
Actualizat: 08 noiembrie 2026

---

## 1. Cum e confirmată achitarea în momentul actual

| Moment | Ce face aplicația | Confirmarea achitării |
|---|---|---|
| Comandă trimisă la bucătărie | POST real către API-ul restaurantului (`createvirtualcart`) → răspuns cu `cartId` real | Neaplicabil — aici nu e implicată plata, ci doar bucătăria |
| „Plătești la ridicare" (TEJ) — fluxul principal | Flux funcțional 100% în aplicație | **Manual**: casiera citește codul `#M-xxx` / scanează QR-ul din `comanda.html` și încasează în casieria fizică a restaurantului (bonul fiscal se emite în afara aplicației) |
| Google Pay | Foaie reală, dar în mod **TEST**, cu `gateway: example` (placeholder), token de test salvat doar ca referință în comandă | **Nicio încasare reală** |
| Apple Pay | Buton mereu vizibil; foaia reală numai pe Safari + Merchant ID + domeniu verificat (momentan neconfigurate) | **Nicio încasare reală** |
| Card (Stripe) | Simulat pentru demo: validează numărul de card prin Luhn și returnează succes | **Nicio încasare reală** |

**Concluzie: NU este încă production-ready din perspectiva plății.**
Totuși, fluxul principal (comandă → bucătărie → cod/QR → încasare la tejghea) este
complet și poate fi lansat așa, dacă se rezolvă doar punctele P0 de mai jos.

Problema actuală vizibilă: API-ul de integrare răspunde **HTTP 401**, deci chiar
canalul spre bucătărie trebuie reactivat (cheie/origin/CORS — detaliat mai jos).

---

## 2. Ce este deja în regulă (nu necesită modificări)

- Comandă fără cont, fără formulare — identificarea prin cod `#M-xxx` + QR.
- Interfața trimite real comenzile către restaurant: `POST
  https://api.rpd.roweb.ro/api/product/integration/createvirtualcart` cu `ApiKey`,
  răspunsul conține `cartId` + URL direct către `pizzeria-sapori-italia.ro`.
- Dacă API-ul nu confirmă, aplicația arată „Reîncearcă trimiterea" — niciodată nu
  se afișează o confirmare falsificată.
- Tichetul clientului (`comanda.html`) funcționează din parametrul din URL,
  independent de aplicație.
- Canal secundar opțional: push ntfy + webhook (configurabile în `js/config.js`).
- Mobile-first, fără emoji-uri, cache-busting pe fiecare versiune, testat e2e pe
  Chromium headless.

---

## 3. Ce mai trebuie făcut înainte de lansarea finală

### P0 — obligatoriu pentru lansare (funcționează împreună cu plata la tejghea)

**P0.1 — Reactivarea API-ului de bucătărie (acum răspunde 401)**
- De clarificat cu Roweb / Sapori Italia:
  - cheia API `bf026006-…` mai este activă? Pentru ce origin/domeniu este permisă?
  - ce structură exactă de payload (`productId`, variații, add-ons) se așteaptă?
  - integrarea permite apel direct din browser (CORS deschis) sau cerem altă rută?
- Criteriu de acceptanță: o comandă de test din aplicație apare pe partea
  restaurantului (site / backend) și aplicația primește `cartId` real, fără „Reîncearcă".

**P0.2 — Cheia API nu mai poate sta în codul de frontend**
- Acum cheia e vizibilă în sursa paginii pentru oricine deschide „View source".
- Soluție minimală: un proxy mic pe domeniul vostru (Cloudflare Worker, PHP simplu,
  Nginx `proxy_pass`) care ține cheia pe server și expune `/api/create-cart`.
- Criteriu: în codul livrat în browser nu mai apar chei sau secrete.

**P0.3 — Privatisirea canalului de notificare ntfy**
- Topicul actual `muncho-sapori-comenzi` îl poate deschide oricine.
- Schimbare într-un nume imposibil de ghicit (sau token de acces ntfy) în
  `js/config.js → dispatch.ntfyTopic`.
- Criteriu: doar telefonul din bucătărie primește push; accesul anonim pe topic
  nu vede nimic.

**P0.4 — Domeniu propriu + HTTPS**
- GitHub Pages (gratuit, HTTPS automat) sau FTP/cPanel pe domeniul restaurantului.
- Actualizare `js/config.js` cu URL-ul real (origini pentru Google Pay / Apple Pay).
- Criteriu: checkout funcțional, foaia Google Pay se deschide pe origin HTTPS.

**P0.5 — Acceptanța codului/QR-ului în operațiune**
- Test real cu casierul: scanare QR → `comanda.html` deschide comanda suficient de
  repede și clar pentru încasare (suma + articolele + metoda „plată la ridicare").
- Criteriu: o casieră nouă rezolvă o ridicare în sub 10 secunde de la scanare.

### P1 — recomandat în prima lună după lansare

**P1.1 — Plată online reală: procesator de card (baza traseului B)**
- Alegerea procesatorului (Stripe / Netopia mobilPay / euPlatesc / PlatiOnline);
  contract + KYC pe restaurant.
- Backend minimal (funcție serverless este suficientă): sesiune de checkout,
  webhook de confirmare, marcaj „achitat" pe comandă.
- Configurare `js/config.js → stripe` cu chei reale și `googlePayEnvironment:
  'PRODUCTION'`; conectarea gateway-ului real în `tokenizationSpecification`
  din `js/payment.js`.
- Criteriu: o plată reală de test (1 leu) apare în dashboard-ul procesatorului,
  iar comanda apare „achitat" în aplicație.

**P1.2 — Plată online reală, traseul B: Apple Pay**
- Apple Developer Program: Merchant ID `merchant.…` și fișierul de verificare
  `/.well-known/apple-developer-merchantid-domain-association.txt` pe domeniu.
- Același backend ca la P1.1 pentru procesarea plății.
- Criteriu: foaia Apple Pay se deschide pe un iPhone real și confirmă o plată de test.

**P1.3 — Statutul comenzii în timp real**
- Acum clientul vede „În pregătire" static. Ideal: marcarea „Gata" de către
  bucătărie, prin polling în proxy sau push.
- Funcționează și fără, dar clienții vor întreba totuși casierul.

**P1.4 — Anulare, reclamă, suport**
- Butonul „Probleme cu comanda?" → telefon restaurant deja prezent în config.
- Procedură scrisă: cum anulează bucătăria un tichet din ntfy / din sistemul lor.

**P1.5 — Testare pe dispozitive fizice**
- iPhone real (Safari): Apple Pay + estimare „Gata în ~N min"; Android real (Chrome):
  foaia Google Pay cu cont merchant real; tabletă de bucătărie cu ntfy.
- Criteriu: 20 de comenzi pilot fără erori în consola monitorizată.

### P2 — după lansare („nice to have")

- **PWA**: `manifest.webmanifest` + service worker simplu → „Add to Home Screen".
- **Monitorizare erori**: Sentry (plan gratuit) pe erorile JS și pe rata de eșec a
  apelurilor `createvirtualcart`, cu alertă pe eșec repetat.
- **Analytics fără cookies** (Plausible/Umami) — scurgerea din fluxul de checkout.
- **Istoric comenzi sincronizat**: acum stă în `localStorage` pe telefon; cu backend-ul
  din P1.1 poate muta pe server.
- **Chitanță pe email/SMS**: opțional, prin Resend / Twilio cu același backend.

---

## 4. Decizii de discutat cu Sapori Italia / furnizori

| Decizie | De ce este necesară |
|---|---|
| Cheie API nouă / clarificare Roweb | 401-ul actual + cheia nu trebuie să expună în frontend |
| Cont merchant Google Pay | pentru foaia Google Pay în PRODUCTION |
| Apple Developer + verificare domeniu | pentru Apple Pay real |
| Alegerea procesatorului de card | dacă se dorește plata online cu card |
| Traseul bonului fiscal | casieria fizică rămâne momentul încasării; aplicația nu emite bonuri |
| Cine stabilește statutul „Gata" | pentru tranziția „în pregătire → gata" din interfața clientului |

---

## 5. Trasee de lansare

**Traseul A — lansare imediată (doar P0): plata la tejghea**
Comanda pleacă real în bucătărie prin API; banii se încasează la ridicare.
Zero backend, zero procesare de card, zero contracte. Cu munca la
integrare (401) și un proxy pentru cheie, se poate lansa în circa 1–2 săptămâni.

**Traseul B — lansarea finală (P0 + P1): plată online cu card**
Include backend-ul minimal, procesatorul de card, Google Pay și Apple Pay în
PRODUCTION. Necesită contracte (KYC) și o etapă de dezvoltare de aproximativ
3–6 săptămâni în plus, în paralel cu operațiunea din traseul A.

---

## 6. Definition of done — lansarea finală

```
[ ] createvirtualcart confirmă comenzi de test → cartId vizibil pe partea restaurantului
[ ] Cheia ApiKey nu mai apare nicăieri în codul de frontend (minim: proxy pe domeniu)
[ ] Topicul ntfy este privat; doar bucătăria primește push
[ ] Domeniu propriu + HTTPS activ pe toate paginile
[ ] Cod QR testat de casieră (procedura de ridicare sub 10 secunde)
[ ] Google Pay în PRODUCTION, cu gateway real (dacă se include plata online)
[ ] Apple Pay real pe Safari (dacă se include plata online)
[ ] 20 comenzi pilot fără incident, monitorizate
[ ] Procedura de suport / anulare convenită cu restaurantul
```

Fiecare element are criteriul de acceptanță detaliat în secțiunea 3.
Acest document se actualizează în repo la fiecare element bifat, împreună
cu commit-ul tehnic corespunzător.
