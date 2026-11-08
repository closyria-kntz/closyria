# Refonte « Cocon lumineux » — écarts avec la maquette (palier 3 bis)

> Statut : **à valider par la fondatrice**. Spec : `docs/specs/2026-11-08-refonte-design.md`.
> Maquette : `docs/maquettes/refonte-a2.html`. Comparaison des formes : https://claude.ai/artifact/2vsadNzN2387JVYUZerfWg

Le palier 3 est en dev (7d6c6f9). La fondatrice trouve que le site ne correspond pas à la maquette et n'aime pas l'arche.
Ce document liste ce qu'on corrige avant d'aller plus loin.

## Décisions validées (2026-11-08)

- **Forme des photos : C « entre les deux »** (remplace D3 « en arche ») : rectangle dont seul le haut est plus
  arrondi. Cartes : haut 44 px, bas 14 px ; vignettes : haut 20 px, bas 8 px ; grande photo de la fiche : même forme.
  La photo remplit toujours la forme (recadrée, jamais de bande vide).
- **Placement sur la photo d'une carte** : émoji seul en **haut à gauche**, rentré de la courbe (16 px du haut et du
  bord), taille normale (pas de gros cœur qui déborde) ; bouton « … » en **haut à droite** ; coche « pris » juste
  sous le « … ».
- **Baisse de prix** : la pastille « −20 € » sort de la photo et se place **à côté du prix**, sous la photo (en bas de
  la photo, elle gênait « Aperçu » et « Je le prends »).

## Écarts à corriger

### Mes envies
1. **En-tête** : grand titre « Mes envies » (Fraunces) + pastilles de résumé : « {n} envies », « {total} en tout »,
   « {n} prix en baisse » (cette dernière seulement s'il y en a).
2. **Barre d'outils** : à droite, loupe (recherche), menu des filtres et du tri, bouton « Ajouter une envie ». Le
   bouton « Filtres » et la liste « Trier par » avec son libellé au-dessus disparaissent (le tri passe dans le menu).
3. **Pastilles de filtre** : pleines et douces (fond `sunken`, sans bord) ; choisie = fond `hint` + texte encre.
4. **Grille** : 4 cartes par ligne sur grand écran (3 sur tablette, 2 sur téléphone).
5. **Cartes** : forme C et placements ci-dessus.
6. **« Ma commande »** : barre fine qui flotte au centre, sur une ligne : « Ma commande », « {n} article(s), {total} »,
   « Il te resterait … », « Voir », « J'ai commandé ({n}) », et la jauge en dessous. Plus de grand bloc avec titre.

### Fiche article
7. **Grande photo et vignettes** en forme C.
8. **Prix** : une pastille « −20 € depuis mardi, le plus bas depuis 3 mois » sous le prix (une seule mention de baisse).
9. **Ton envie** : les 4 niveaux restent en tuiles (décision du cahier des charges) ; le « pourquoi » enregistré
   s'affiche en citation en italique, le champ n'apparaît qu'en le modifiant ; « Prioritaire » en petite pastille cochée.
10. **Boutons** « Je le prends », « Voir chez {boutique} », « Partager » alignés sur une ligne sous les blocs.

## Question ouverte

- Liste partagée entre deux profils : la grille n'affiche que les articles du profil courant, alors que « Ma commande »
  compte aussi ceux de l'autre profil. Recommandation : afficher aussi les articles de l'autre profil dans la grille
  d'une liste.

## Méthode

Captures du site comparées à la maquette avant chaque mise en dev ; rien en dev sans l'accord de la fondatrice.
