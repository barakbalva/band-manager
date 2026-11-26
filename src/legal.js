// Privacy policy and terms for BandBase, served at /privacy and /terms (?lang=en|nl|fr|de).
// {OWNER} and {EMAIL} come from kv 'legal' (admin → Control panel), so no personal data lives in this public repo.
// Plain-language texts written for a small free service; have them checked before charging money.

const UPDATED = '2026-11-26';

const L = {
 en: {
  privacy: ['Privacy policy', `
<p>BandBase is a web app for bands: songs, setlists, a shared calendar, the band's mail and projects. It is run by {OWNER} (Belgium). Contact: <a href="mailto:{EMAIL}">{EMAIL}</a>.</p>
<h2>What we store</h2>
<ul><li><b>Your account:</b> name, email address and your password (only as a salted hash, never readable).</li>
<li><b>Your band's content:</b> songs, lyrics and chords, setlists, projects, availability answers and the band settings members enter.</li>
<li><b>If your band connects Google Calendar:</b> events are read from and written to your band's own Google Calendar. We do not keep a copy of them.</li>
<li><b>If your band connects its Gmail:</b> a copy of incoming mail (plain text, sender, subject, attachment names – not the attachments) so members can read it in the app.</li>
<li><b>Notifications:</b> if you turn them on, your device's push address and language.</li>
<li><b>One cookie</b> that keeps you logged in. No advertising, no tracking, no analytics cookies. That is why there is no cookie banner.</li></ul>
<h2>Why</h2>
<p>Only to run the app for you and your band (performance of the agreement you make when you sign up). We do not sell or share your data, and we do not use it for advertising.</p>
<h2>Who processes it for us</h2>
<ul><li><b>Cloudflare</b> hosts the app and the database (servers worldwide, under EU standard contractual clauses).</li>
<li><b>Google</b>, only if your band connects its own calendar or Gmail.</li></ul>
<h2>How long</h2>
<p>As long as you have an account. Deleting your account or your band (Settings) removes the data right away; weekly backups of a band are kept up to 12 weeks and are removed with the band.</p>
<h2>Your rights</h2>
<p>You can see, export (Settings → Export backup), correct and delete your data yourself in the app, or ask us by email. You can also complain to the Belgian Data Protection Authority (<a href="https://www.dataprotectionauthority.be" rel="noopener">dataprotectionauthority.be</a>).</p>`],
  terms: ['Terms of use', `
<p>These terms apply to BandBase, run by {OWNER} (Belgium). Contact: <a href="mailto:{EMAIL}">{EMAIL}</a>. By creating an account you accept them.</p>
<h2>Free during the launch</h2>
<p>BandBase is free during the launch period. Later we may offer paid plans to cover server costs. If that happens: we tell every band at least 30 days in advance, nobody is charged automatically, and you can always export your data and leave. Bands that join during the launch period ("founding bands") keep the features they use for free.</p>
<h2>Your content</h2>
<p>You and your band own what you put in BandBase. You are responsible for it, including lyrics and other material that may be protected by copyright: store it for your band's own use only. We only use your content to run the app.</p>
<h2>Fair use</h2>
<p>Don't use BandBase for anything illegal, to send spam, or to try to get into other bands' data. We may close accounts that do.</p>
<h2>The service</h2>
<p>We do our best to keep BandBase running and your data safe (including weekly backups), but the app is offered as it is, without guarantees. Keep your own exports of what matters to you. As far as the law allows, we are not liable for indirect damage or lost data.</p>
<h2>Leaving</h2>
<p>You can delete your account or your band at any time in Settings. We may end the service with at least 30 days' notice, so you have time to export your data.</p>
<h2>Changes and law</h2>
<p>If these terms change in an important way, we tell you in the app. Belgian law applies.</p>`],
  updated: 'Last updated', back: 'Back to BandBase', other: 'Privacy policy', otherT: 'Terms of use',
 },
 nl: {
  privacy: ['Privacybeleid', `
<p>BandBase is een webapp voor bands: nummers, setlists, een gedeelde agenda, de mail van de band en projecten. De app wordt beheerd door {OWNER} (België). Contact: <a href="mailto:{EMAIL}">{EMAIL}</a>.</p>
<h2>Wat we bewaren</h2>
<ul><li><b>Je account:</b> naam, e-mailadres en je wachtwoord (alleen als gesalte hash, nooit leesbaar).</li>
<li><b>De inhoud van je band:</b> nummers, teksten en akkoorden, setlists, projecten, antwoorden over beschikbaarheid en de bandinstellingen die leden invullen.</li>
<li><b>Als je band Google Agenda koppelt:</b> afspraken worden gelezen uit en geschreven naar de eigen Google Agenda van de band. We bewaren er geen kopie van.</li>
<li><b>Als je band haar Gmail koppelt:</b> een kopie van binnenkomende mail (platte tekst, afzender, onderwerp, namen van bijlagen – niet de bijlagen) zodat leden die in de app kunnen lezen.</li>
<li><b>Meldingen:</b> als je ze aanzet, het pushadres en de taal van je toestel.</li>
<li><b>Eén cookie</b> die je ingelogd houdt. Geen reclame, geen tracking, geen analysecookies. Daarom is er geen cookiebanner.</li></ul>
<h2>Waarom</h2>
<p>Alleen om de app te laten werken voor jou en je band (uitvoering van de overeenkomst die je sluit bij het registreren). We verkopen of delen je gegevens niet en gebruiken ze niet voor reclame.</p>
<h2>Wie ze voor ons verwerkt</h2>
<ul><li><b>Cloudflare</b> host de app en de database (servers wereldwijd, met de EU-standaardcontractbepalingen).</li>
<li><b>Google</b>, alleen als je band haar eigen agenda of Gmail koppelt.</li></ul>
<h2>Hoe lang</h2>
<p>Zolang je een account hebt. Als je je account of je band verwijdert (Instellingen), zijn de gegevens meteen weg; wekelijkse backups van een band blijven tot 12 weken en verdwijnen samen met de band.</p>
<h2>Je rechten</h2>
<p>Je kunt je gegevens zelf bekijken, exporteren (Instellingen → Backup exporteren), aanpassen en verwijderen in de app, of het ons per mail vragen. Je kunt ook klacht indienen bij de Gegevensbeschermingsautoriteit (<a href="https://www.gegevensbeschermingsautoriteit.be" rel="noopener">gegevensbeschermingsautoriteit.be</a>).</p>`],
  terms: ['Gebruiksvoorwaarden', `
<p>Deze voorwaarden gelden voor BandBase, beheerd door {OWNER} (België). Contact: <a href="mailto:{EMAIL}">{EMAIL}</a>. Door een account te maken ga je ermee akkoord.</p>
<h2>Gratis tijdens de lancering</h2>
<p>BandBase is gratis tijdens de lanceringsperiode. Later kunnen we betaalde plannen aanbieden om de serverkosten te dekken. Als dat gebeurt: we laten het elke band minstens 30 dagen vooraf weten, niemand betaalt automatisch, en je kunt altijd je gegevens exporteren en vertrekken. Bands die tijdens de lancering lid worden ("founding bands") houden de functies die ze gebruiken gratis.</p>
<h2>Je inhoud</h2>
<p>Wat je in BandBase zet, is van jou en je band. Je bent er zelf verantwoordelijk voor, ook voor teksten en ander materiaal dat auteursrechtelijk beschermd kan zijn: bewaar het alleen voor eigen gebruik door je band. We gebruiken je inhoud alleen om de app te laten werken.</p>
<h2>Eerlijk gebruik</h2>
<p>Gebruik BandBase niet voor iets illegaals, om spam te sturen of om in de gegevens van andere bands te komen. We kunnen accounts die dat doen sluiten.</p>
<h2>De dienst</h2>
<p>We doen ons best om BandBase draaiende en je gegevens veilig te houden (met wekelijkse backups), maar de app wordt aangeboden zoals hij is, zonder garanties. Bewaar zelf exports van wat belangrijk is. Voor zover de wet het toelaat, zijn we niet aansprakelijk voor indirecte schade of verloren gegevens.</p>
<h2>Vertrekken</h2>
<p>Je kunt je account of je band op elk moment verwijderen in Instellingen. Als we de dienst stoppen, laten we dat minstens 30 dagen vooraf weten, zodat je tijd hebt om je gegevens te exporteren.</p>
<h2>Wijzigingen en recht</h2>
<p>Als deze voorwaarden belangrijk veranderen, laten we het je weten in de app. Het Belgisch recht is van toepassing.</p>`],
  updated: 'Laatst bijgewerkt', back: 'Terug naar BandBase', other: 'Privacybeleid', otherT: 'Gebruiksvoorwaarden',
 },
 fr: {
  privacy: ['Politique de confidentialité', `
<p>BandBase est une application web pour les groupes : morceaux, setlists, agenda partagé, mail du groupe et projets. Elle est gérée par {OWNER} (Belgique). Contact : <a href="mailto:{EMAIL}">{EMAIL}</a>.</p>
<h2>Ce que nous enregistrons</h2>
<ul><li><b>Ton compte :</b> nom, adresse e-mail et mot de passe (uniquement sous forme de hachage salé, jamais lisible).</li>
<li><b>Le contenu de ton groupe :</b> morceaux, paroles et accords, setlists, projets, réponses de disponibilité et réglages du groupe.</li>
<li><b>Si ton groupe connecte Google Agenda :</b> les événements sont lus et écrits dans l’agenda Google du groupe. Nous n’en gardons pas de copie.</li>
<li><b>Si ton groupe connecte son Gmail :</b> une copie des mails reçus (texte brut, expéditeur, objet, noms des pièces jointes – pas les pièces jointes) pour que les membres puissent les lire dans l’app.</li>
<li><b>Notifications :</b> si tu les actives, l’adresse push et la langue de ton appareil.</li>
<li><b>Un seul cookie</b> pour rester connecté. Pas de publicité, pas de pistage, pas de cookies d’analyse. C’est pourquoi il n’y a pas de bandeau cookies.</li></ul>
<h2>Pourquoi</h2>
<p>Uniquement pour faire fonctionner l’app pour toi et ton groupe (exécution du contrat conclu à l’inscription). Nous ne vendons ni ne partageons tes données et ne les utilisons pas pour de la publicité.</p>
<h2>Qui les traite pour nous</h2>
<ul><li><b>Cloudflare</b> héberge l’app et la base de données (serveurs dans le monde entier, avec les clauses contractuelles types de l’UE).</li>
<li><b>Google</b>, seulement si ton groupe connecte son propre agenda ou Gmail.</li></ul>
<h2>Combien de temps</h2>
<p>Tant que tu as un compte. Supprimer ton compte ou ton groupe (Réglages) efface les données immédiatement ; les sauvegardes hebdomadaires d’un groupe sont gardées jusqu’à 12 semaines et supprimées avec le groupe.</p>
<h2>Tes droits</h2>
<p>Tu peux consulter, exporter (Réglages → Exporter une sauvegarde), corriger et supprimer tes données toi-même dans l’app, ou nous le demander par e-mail. Tu peux aussi porter plainte auprès de l’Autorité de protection des données (<a href="https://www.autoriteprotectiondonnees.be" rel="noopener">autoriteprotectiondonnees.be</a>).</p>`],
  terms: ['Conditions d’utilisation', `
<p>Ces conditions s’appliquent à BandBase, géré par {OWNER} (Belgique). Contact : <a href="mailto:{EMAIL}">{EMAIL}</a>. En créant un compte, tu les acceptes.</p>
<h2>Gratuit pendant le lancement</h2>
<p>BandBase est gratuit pendant la période de lancement. Plus tard, nous pourrons proposer des formules payantes pour couvrir les frais de serveur. Si c’est le cas : nous prévenons chaque groupe au moins 30 jours à l’avance, personne n’est facturé automatiquement, et tu peux toujours exporter tes données et partir. Les groupes inscrits pendant le lancement (« groupes fondateurs ») gardent gratuitement les fonctions qu’ils utilisent.</p>
<h2>Ton contenu</h2>
<p>Ce que tu mets dans BandBase appartient à toi et à ton groupe. Tu en es responsable, y compris des paroles et autres contenus protégés par le droit d’auteur : garde-les uniquement pour l’usage de ton groupe. Nous n’utilisons ton contenu que pour faire fonctionner l’app.</p>
<h2>Usage loyal</h2>
<p>N’utilise pas BandBase pour quelque chose d’illégal, pour envoyer du spam ou pour accéder aux données d’autres groupes. Nous pouvons fermer les comptes qui le font.</p>
<h2>Le service</h2>
<p>Nous faisons de notre mieux pour que BandBase fonctionne et que tes données soient en sécurité (avec des sauvegardes hebdomadaires), mais l’app est fournie telle quelle, sans garantie. Garde tes propres exports de ce qui compte. Dans la mesure permise par la loi, nous ne sommes pas responsables des dommages indirects ou des données perdues.</p>
<h2>Partir</h2>
<p>Tu peux supprimer ton compte ou ton groupe à tout moment dans Réglages. Si nous arrêtons le service, nous prévenons au moins 30 jours à l’avance pour que tu puisses exporter tes données.</p>
<h2>Modifications et droit applicable</h2>
<p>Si ces conditions changent de façon importante, nous te prévenons dans l’app. Le droit belge s’applique.</p>`],
  updated: 'Dernière mise à jour', back: 'Retour à BandBase', other: 'Politique de confidentialité', otherT: 'Conditions d’utilisation',
 },
 de: {
  privacy: ['Datenschutzerklärung', `
<p>BandBase ist eine Web-App für Bands: Songs, Setlists, ein gemeinsamer Kalender, die Mail der Band und Projekte. Betrieben von {OWNER} (Belgien). Kontakt: <a href="mailto:{EMAIL}">{EMAIL}</a>.</p>
<h2>Was wir speichern</h2>
<ul><li><b>Dein Konto:</b> Name, E-Mail-Adresse und dein Passwort (nur als gesalzener Hash, nie lesbar).</li>
<li><b>Die Inhalte deiner Band:</b> Songs, Texte und Akkorde, Setlists, Projekte, Antworten zur Verfügbarkeit und die Bandeinstellungen.</li>
<li><b>Wenn deine Band Google Kalender verbindet:</b> Termine werden im eigenen Google Kalender der Band gelesen und geschrieben. Wir behalten keine Kopie.</li>
<li><b>Wenn deine Band ihr Gmail verbindet:</b> eine Kopie eingehender Mails (Klartext, Absender, Betreff, Namen der Anhänge – nicht die Anhänge), damit Mitglieder sie in der App lesen können.</li>
<li><b>Benachrichtigungen:</b> wenn du sie einschaltest, die Push-Adresse und Sprache deines Geräts.</li>
<li><b>Ein Cookie</b>, das dich angemeldet hält. Keine Werbung, kein Tracking, keine Analyse-Cookies. Deshalb gibt es kein Cookie-Banner.</li></ul>
<h2>Warum</h2>
<p>Nur um die App für dich und deine Band zu betreiben (Erfüllung des Vertrags, den du bei der Registrierung schließt). Wir verkaufen oder teilen deine Daten nicht und nutzen sie nicht für Werbung.</p>
<h2>Wer sie für uns verarbeitet</h2>
<ul><li><b>Cloudflare</b> hostet die App und die Datenbank (Server weltweit, mit den EU-Standardvertragsklauseln).</li>
<li><b>Google</b>, nur wenn deine Band ihren eigenen Kalender oder ihr Gmail verbindet.</li></ul>
<h2>Wie lange</h2>
<p>Solange du ein Konto hast. Wenn du dein Konto oder deine Band löschst (Einstellungen), sind die Daten sofort weg; wöchentliche Backups einer Band bleiben bis zu 12 Wochen und werden mit der Band gelöscht.</p>
<h2>Deine Rechte</h2>
<p>Du kannst deine Daten in der App selbst einsehen, exportieren (Einstellungen → Backup exportieren), berichtigen und löschen oder uns per Mail fragen. Du kannst dich auch bei der belgischen Datenschutzbehörde beschweren (<a href="https://www.dataprotectionauthority.be" rel="noopener">dataprotectionauthority.be</a>).</p>`],
  terms: ['Nutzungsbedingungen', `
<p>Diese Bedingungen gelten für BandBase, betrieben von {OWNER} (Belgien). Kontakt: <a href="mailto:{EMAIL}">{EMAIL}</a>. Mit dem Anlegen eines Kontos stimmst du ihnen zu.</p>
<h2>Kostenlos während des Starts</h2>
<p>BandBase ist während der Startphase kostenlos. Später bieten wir eventuell kostenpflichtige Pläne an, um die Serverkosten zu decken. Falls ja: Wir informieren jede Band mindestens 30 Tage vorher, niemand wird automatisch belastet, und du kannst jederzeit deine Daten exportieren und gehen. Bands, die während der Startphase beitreten („Gründungsbands“), behalten die Funktionen, die sie nutzen, kostenlos.</p>
<h2>Deine Inhalte</h2>
<p>Was du in BandBase speicherst, gehört dir und deiner Band. Du bist dafür verantwortlich, auch für Songtexte und anderes urheberrechtlich geschütztes Material: Speichere es nur für den eigenen Gebrauch deiner Band. Wir nutzen deine Inhalte nur, um die App zu betreiben.</p>
<h2>Faire Nutzung</h2>
<p>Nutze BandBase nicht für Illegales, für Spam oder um an die Daten anderer Bands zu kommen. Konten, die das tun, können wir schließen.</p>
<h2>Der Dienst</h2>
<p>Wir tun unser Bestes, damit BandBase läuft und deine Daten sicher sind (mit wöchentlichen Backups), aber die App wird so angeboten, wie sie ist, ohne Garantie. Bewahre eigene Exporte von Wichtigem auf. Soweit gesetzlich zulässig, haften wir nicht für indirekte Schäden oder verlorene Daten.</p>
<h2>Gehen</h2>
<p>Du kannst dein Konto oder deine Band jederzeit in den Einstellungen löschen. Wenn wir den Dienst einstellen, kündigen wir das mindestens 30 Tage vorher an, damit du deine Daten exportieren kannst.</p>
<h2>Änderungen und Recht</h2>
<p>Wenn sich diese Bedingungen wesentlich ändern, informieren wir dich in der App. Es gilt belgisches Recht.</p>`],
  updated: 'Zuletzt aktualisiert', back: 'Zurück zu BandBase', other: 'Datenschutzerklärung', otherT: 'Nutzungsbedingungen',
 },
};

const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function legalPage(kind, lang, info) {
  const lg = L[lang] ? lang : 'en', T = L[lg];
  const [title, body] = T[kind];
  const owner = escH(info.owner || 'the BandBase team'), email = escH(info.email || '');
  const html = body.replaceAll('{OWNER}', owner).replaceAll('{EMAIL}', email);
  const langs = Object.keys(L).map(l => `<a href="?lang=${l}"${l === lg ? ' class="on"' : ''}>${l.toUpperCase()}</a>`).join(' ');
  const other = kind === 'privacy' ? `<a href="/terms?lang=${lg}">${T.otherT}</a>` : `<a href="/privacy?lang=${lg}">${T.other}</a>`;
  return `<!DOCTYPE html><html lang="${lg}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · BandBase</title><link rel="icon" href="/icon-192.png"><style>
body{margin:0;background:#111114;color:#ececf1;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:28px 20px 60px}a{color:#f5a524}h1{font-size:26px;margin:18px 0 4px}h2{font-size:18px;margin:26px 0 6px}
.top{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}.top img{width:40px;height:40px;border-radius:10px;vertical-align:middle}
.langs a{margin-left:8px;text-decoration:none;color:#9a9aa6}.langs a.on{color:#ececf1;font-weight:700}.muted{color:#9a9aa6;font-size:14px}ul{padding-left:20px}
</style></head><body><main><div class="top"><a href="/"><img src="/icon-192.png" alt=""> BandBase</a><span class="langs">${langs}</span></div>
<h1>${title}</h1><p class="muted">${T.updated}: ${UPDATED}</p>${html}<p style="margin-top:34px">${other} · <a href="/">${T.back}</a></p></main></body></html>`;
}
