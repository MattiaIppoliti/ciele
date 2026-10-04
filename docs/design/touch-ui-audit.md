# Design review: Ciele su iPhone e iPad

## Summary

Review del 4 ottobre 2026, con entrambe le skill Apple Design richieste. Le correzioni intervengono sui componenti condivisi e sulle superfici di scroll dei moduli, mantenendo il menu circolare, il dock flottante e lo sfondo `#0F1011` scelti per Ciele. Valutazione: **Needs work** per la validazione su dispositivi, ancora pendente; i difetti confermati nel codice descritti sotto sono corretti.

**Limite di verifica:** l'accesso automatico a localhost viene negato perché il browser non può verificare la policy amministrativa. Nessuna prova di tap, screenshot, contrasto misurato, VoiceOver o tastiera Safari viene presentata come completata. Non sono stati aggirati i controlli del browser.

## Critical — corretti nel codice

| Problema e impatto | Correzione | Riferimento HIG |
| --- | --- | --- |
| Menu e pulsanti da 24–36 px, anche nei portali; azioni difficili da premere. | Minimo 44 × 44 CSS px per pulsanti, menu, tab e righe interattive nelle viste strette o con puntatore touch. Switch con area invisibile di 44 px; dimensioni visive del toggle conservate. Swipe row corte portate a 44 px. | `hig/accessibility.md` › Mobility: “Offer sufficiently sized controls.” |
| I dialog lunghi possono uscire dal viewport e nascondere le azioni finali. | Altezza massima legata a `100dvh` e safe area, scroll verticale e contenimento dello scroll. Le superfici intenzionalmente a tutto schermo mantengono `max-h-none`. | `hig/scroll-views.md` › Best practices: “Support default scrolling gestures and keyboard shortcuts.” |
| I Select inline consideravano lo schermo, ma ignoravano il pannello che li taglia. Il focus delle opzioni poteva scrollare anche il form. | Geometria limitata dall'intersezione fra viewport visibile e antenati che tagliano lo scroll; scelta del lato disponibile, aggiornamento su rotazione, scroll e tastiera. Il focus scorre solo l'elenco. Escape chiude prima la selezione. | `hig/layout.md` › Adaptability: “Design a layout that adapts gracefully and consistently.” |
| Popover larghi e menu animati potevano uscire dal bordo dello schermo. | Limiti di larghezza dei popup Base UI; clamping, inversione del lato e scroll dei MorphPopover nel viewport visibile. | `hig/popovers.md` › Best practices: “Avoid making a popover too big.” |
| Developer panel aperto ma nascosto sotto il breakpoint desktop; roster e gruppi dipendenti dalla sidebar nascosta nelle viste touch. | Developer/Workspace riutilizzano FrameRailPanel in un dialog a tutto schermo. Teammates ha un pulsante Chats che apre roster, gruppi e cronologia, usando lo stesso componente e lo stesso leave guard. La navigazione completata chiude il picker; una navigazione annullata lo mantiene. | `hig/layout.md` › Adaptability: “Keep functionality the same as size classes change”. |
| Le azioni Open delle tabelle e alcune azioni di risorse/Flows apparivano solo al passaggio del mouse. | Controlli sempre visibili nelle viste touch; spazio riservato al pulsante Open per non coprire il titolo. | `hig/buttons.md` › Best practices: “Make buttons easy for people to use.” |
| Dock e notifiche potevano coprire l'ultima riga, il composer o Save; il contenitore Settings poteva impedire al figlio di ridursi e scrollare. | Clearances nei principali scroller e nella pagina chat, save bar mobile sopra il dock, notifiche sopra i controlli flottanti, `min-h-0` e `min-w-0` nei contenitori. Il dock si nasconde nelle superfici chat/pannelli a tutto schermo. | `hig/accessibility.md` › Mobility: “Offer sufficiently sized controls.” |

## Improvements — applicati

- **High · Layout:** le griglie di Personal/Organization Settings seguono la larghezza del pannello (`@container/settings`), anziché quella del dispositivo. Rimossa la colonna di padding che restringeva inutilmente i form. Riferimento: `hig/layout.md` › Size classes.
- **High · Composer:** testo, layer di highlight e misura usano la stessa dimensione di 16 px nelle viste touch, compresi gli iPad larghi. Il selettore del modello si restringe e Send/Voice mantengono il proprio spazio. Riferimento: `hig/virtual-keyboards.md` › Mobile devices; `hig/typography.md` › Ensuring legibility.
- **High · Navbar:** i controlli di pagina hanno uno scroller orizzontale limitato; il breadcrumb può restringersi e nessuna azione viene rimossa per recuperare spazio. Riferimento: `hig/layout.md` › Adaptability.
- **Medium · Calendario:** due mesi si impilano nelle viste touch; i sette giorni rientrano anche a 320 px. I giorni arrivano a 44 px quando c'è spazio; a 320 px la griglia usa circa 36,6 px, sopra il minimo compatto di 28 della tabella HIG. La navigazione mese mantiene 44 px. Riferimento: `hig/accessibility.md` › Mobility.
- **Medium · Canvas:** i controlli della toolbar sono da 44 px e la toolbar può scrollare su schermi bassi. Le maniglie di riordino sono da 44 px; i separatori di resize arrivano al minimo compatto di 28 px e conservano i comandi da tastiera. Riferimento: `hig/buttons.md` › Best practices; `hig/scroll-views.md` › Best practices.

## What works

- Tabelle dati con scroll orizzontale nativo e colonne persistenti: la semantica della tabella resta leggibile e non viene convertita in una serie di card scollegate. `hig/lists-and-tables.md` › Best practices.
- Swipe con alternative esplicite, conferma della cancellazione e scroll verticale consentito: archivio, flag e delete mantengono i confini già esistenti. `hig/accessibility.md` › Mobility.
- Token di colore condivisi, focus visibile e override per forced colors. Nessuna nuova dipendenza del significato dal solo colore. La review non certifica rapporti di contrasto senza una misura del rendering. `hig/color.md` › Best practices; `hig/accessibility.md` › Vision.
- Animazioni, feedback tattile e preferenze di movimento restano nei componenti esistenti. Le nuove viste riusano questi componenti; non aggiungono un'animazione alternativa. `cross-platform.md` › Web translation.
- Login ha già un contenitore scorrevole per viewport bassi e campi da 16 px. Preview, widget e Teammates condividono PromptInput. `hig/virtual-keyboards.md` › Mobile devices.

## Platform notes e copertura

È una UI web: 44 CSS px è una scelta operativa per i bersagli touch, non una dichiarazione che CSS px e punti nativi siano sempre equivalenti. Sono stati applicati i principi di accessibilità e adattabilità, rispettando le scelte di navigazione della piattaforma. Sono stati consultati anche `hig/designing-for-ios.md` e `cross-platform.md`.

| Area | Superfici esaminate nel codice |
| --- | --- |
| Shell | Navbar, scope/org switcher, Find, menu circolare, dock, notifiche, pannelli a destra |
| Organization Settings | General, Members, AI Provider/defaults/connections/budget, Crawling, API Keys, Usage, Billing |
| Personal Settings | Profile, Theme, Memory, connessioni personali |
| Assistants | Overview, General, Knowledge, Flows/canvas/configurazione, Goals, Guardrails, Help Desks, Style, Authentication, Tools, Publish, Preview |
| Library | Hub e filtri, Websites/Files/Applications/FAQs, fonti, documenti, import, tabelle e popup |
| Conversazioni | Inbox/lista/transcript/metadati, chat widget, preview, Teammates, gruppi, history, roster, workspace e agent screen |
| Operazioni | Help Desks, ticketing, Improvements/lista/kanban/detail, Alerts, Reviews |
| Analytics | Eval/library/run, Insights/observability/costs/admin/exports |
| Accesso | Login, auth shell, redirect signup |

La copertura è per famiglie di route e componenti riusati, **non** una visita browser a ogni URL né una prova con ogni combinazione di dati reali. Nessuna modifica a permessi, runtime agenti, persistenza o pubblicazione.

## Verification

- Dieci test della geometria/focus dei menu: lato preferito, flip, scrollport Settings, viewport ridotto dalla tastiera, larghezza 320 px, shift orizzontale, menu lunghi e opzione fuori vista.
- Typecheck web e lint: passano; tre warning già presenti in citations, tooltip chart e action-swap.
- Gate completo `pnpm verify`: passato, inclusi build, test, security, boundaries, Docker manifest e budget di bundle/documenti. Il pre-push lo esegue di nuovo sul commit finale.
- Nessun test che confronta semplicemente stringhe CSS con l'implementazione.

Prima di certificare la UI restano da eseguire su browser/dispositivi: 320/390/430 px, iPad 768/1024/1366 px, landscape basso, tastiera aperta, zoom testo 200%, light/dark, Reduce Motion, Reduce Transparency, forced colors e VoiceOver. Percorsi prioritari: Select vicino al fondo del form; Save sopra il dock; menu chat e ritorno alla conversazione; date range; colonne/actions delle tabelle; toolbar canvas; preview e agent screen a tutto schermo.
