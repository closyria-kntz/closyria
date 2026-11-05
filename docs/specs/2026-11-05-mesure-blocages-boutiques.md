# Mesure des blocages anti-robot — boutiques de départ (2026-11-05)

Mesure faite avant la conception du chantier 1. Elle sert à choisir entre une lecture
simple des pages et d'autres voies de capture.

## Méthode

- Depuis dark-mystery (adresse OVH), le 2026-11-05.
- Identifiant annoncé : `Mozilla/5.0 (compatible; ClosyriaBot/0.1; +https://closyria.com)`.
- Pas de cookies, pas d'exécution JavaScript, 1 s entre deux requêtes.
- Par boutique : `robots.txt`, puis page d'accueil (ou `/products.json` pour Shopify),
  puis une page produit quand on a pu en trouver une.
- Script jetable, hors dépôt.

## Résultats

| Boutique | Réponse | Protection repérée | Données sur la page produit |
|---|---|---|---|
| MCB Paris | ✅ 200 | — | Shopify `.js` + JSON-LD Product + Open Graph |
| Easy Clothes | ✅ 200 | — | idem |
| My1996 | ✅ 200 | — | idem |
| Ohlala | ✅ 200 | — | idem |
| Le Dressing de Paolina | ✅ 200 | — | idem |
| Intemporel Shop | ✅ 200 | — | idem |
| Promod | ✅ 200 | — | JSON-LD Product + offres + Open Graph |
| Zalando | ✅ 200 | — | JSON-LD Product + offres + tailles + Open Graph |
| Shein | ⚠️ 200, mais page de vérification | anti-robot maison | rien d'exploitable |
| Zara | ❌ 403 | non identifiée | — |
| Mango | ❌ 429 | non identifiée | — |
| H&M | ❌ 403 | Akamai | — |
| Etam | ❌ 403 | Akamai | — |
| Sézane | ❌ 403 | DataDome | — |
| Kiabi | ❌ 403 | DataDome | — |
| Vinted | ❌ 403 | Cloudflare | — |
| Vestiaire Collective | ❌ 403 | Cloudflare | — |
| La Redoute | ❌ 403 | non identifiée | — |

Pages produit lues en 0,2 à 0,6 s, et le fichier `.js` de Shopify en 0,1 à 0,2 s.
L'objectif de 5 s est donc largement tenu sur les boutiques accessibles.

**Bilan : 8 boutiques sur 18 sont accessibles, 10 sont bloquées.** Les blocages tombent
dès la page d'accueil ou `robots.txt`, avant toute page produit.

## Limite de la mesure

On ne sait pas si c'est l'identifiant de robot ou l'adresse du serveur qui est bloqué.
Une comparaison avec une identité de navigateur a été refusée par le garde-fou de
Claude Code (« contournement d'une vérification anti-robot »). Ce refus va dans le
sens de la spec, qui prévoit un robot identifié. Se faire passer pour un navigateur
ou passer par un navigateur automatisé pour franchir ces protections revient à les
contourner : ces voies sont donc écartées.

## Conséquence pour le chantier 1

Les voies légitimes pour les enseignes bloquées :
- **la saisie manuelle** pré-remplie avec ce qu'on sait (nom de la boutique d'après
  l'adresse, et nom de l'article tiré de l'adresse quand c'est possible) ;
- **la capture depuis l'appareil de l'utilisatrice** : sa page, lue dans son propre
  navigateur ou avec son action (partage, extension, marque-page) ;
- **les catalogues officiels** des programmes d'affiliation (chantier 5).
