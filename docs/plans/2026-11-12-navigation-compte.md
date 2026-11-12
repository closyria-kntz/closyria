# Navigation : Mes articles et Compte — plan de travail (passe de retours rapide)

**Pourquoi :** la fondatrice se perd entre « Mes articles » et « Moi » (analyse du 2026-11-12, règles `nav-hierarchy` / `navigation-consistency`) : « Moi » est à trois endroits (onglet, sélecteur de profil « Moi ▾ », avatar « M ») et la page « Moi » répète les articles (tuiles Dressing / À vendre, grille « Mon dressing », liste « Toutes mes pages »).

**Décisions validées (2026-11-12) :**
1. « Mes articles » = tout ce qui touche aux vêtements (envies, commandés, reçus, dressing, à vendre, listes, commandes groupées ; budget en haut des envies, comme aujourd'hui).
2. L'onglet « Moi » devient **« Compte »** (`/compte`, `/moi` redirige) et ne contient aucun article : profil (prénom, e-mail, connexion), profils de la famille, apparence (clair / sombre), réglages, « Ajouter depuis ton téléphone », aide. Les tuiles, la grille du dressing et « Toutes mes pages » disparaissent de cette page (tout reste accessible dans « Mes articles » et l'accueil).
3. Le sélecteur de profil du bandeau affiche le prénom du profil choisi (« Camille ▾ ») au lieu de « Moi ».
4. L'avatar en double du bandeau disparaît (le compte = l'onglet « Compte » ; sur ordinateur, lien « Compte » dans le bandeau).
5. « Mes articles » allégé : « Articles · Listes · Commandes groupées » devient une ligne de liens discrète (texte, souligné pour l'actif), pas un gros sélecteur ; les vêtements remontent.

**Contraintes :** celles du plan Boudoir (`docs/plans/2026-11-11-refonte-boudoir.md`, Global Constraints) ; rien ne disparaît (chaque destination de l'ancienne page Moi reste atteignable) ; e2e adaptés ; axe clair/sombre ; 44 px.

- [ ] Compte : page, redirection `/moi` → `/compte`, menu (téléphone et ordinateur), e2e « chaque ancienne destination de Moi est atteignable » (depuis Compte ou Mes articles).
- [ ] Sélecteur de profil : prénom du profil ; avatar retiré ; e2e.
- [ ] Mes articles : ligne de liens discrète ; capture téléphone : premier article visible dans la première moitié de l'écran.
- [ ] Suite e2e complète ; une relecture d'ensemble ; commit « feat(navigation): Mes articles et Compte ».
