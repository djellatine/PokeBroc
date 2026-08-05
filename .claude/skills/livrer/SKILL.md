---
name: livrer
description: Vérifier, commiter et pousser une fonctionnalité terminée sur PokeBroc. À invoquer dès qu'une fonctionnalité, une correction ou un refactor est fini et que le travail tient debout — sans attendre que l'utilisateur demande « push ». Couvre aussi les demandes explicites de type « commit », « pousse sur git », « livre ça ».
---

# Livrer une fonctionnalité

Le dépôt travaille directement sur `main`, qui suit `origin/main`. Pas de branche
de fonctionnalité, pas de PR : un commit par unité de sens, poussé aussitôt.

## 1. Vérifier avant de commiter

Dans l'ordre, et **en entier** — un commit poussé sur `main` est visible tout de
suite, il n'y a pas de CI pour rattraper :

```bash
npm test           # node:test — 109 tests au 5 août 2026
npx tsc --noEmit
npm run lint
npm run build      # indispensable, voir plus bas
python collect/test_lbc.py   # seulement si collect/ est touché
```

`npm run build` n'est pas redondant avec `tsc` : c'est le **seul** à voir un
module serveur entraîné dans le paquet client. Un `import { X } from "@/lib/feed"`
qui porte sur une valeur (et non un type, effacé à la compilation) tire
`node:fs/promises` dans le navigateur et casse le build ; ni `tsc` ni le linter
ne le signalent. Ce qui traverse la frontière serveur/client vit dans
`lib/source.ts`, sans le moindre import.

Si une vérification échoue, corriger avant de commiter. Ne jamais commiter un
état rouge « pour ne pas perdre le travail ».

## 2. La documentation fait partie de la fonctionnalité

Le `README.md` est le document de référence du projet : il explique *pourquoi*
chaque décision a été prise, avec les mesures qui la justifient. Une
fonctionnalité qui change un comportement, un seuil ou une route et ne touche pas
le README est incomplète. Vérifier en particulier :

- l'arborescence commentée en fin de README (routes, composants, modules) ;
- les seuils chiffrés cités dans le texte (validités, cadences, nombres de
  recherches) — ils sont écrits en toutes lettres et se périment en silence ;
- la section des limites connues, et celle des suites envisagées.

## 3. Le message de commit

Style du dépôt, à respecter :

- **français, sans accents**, sujet comme corps (`hebergement`, `marche`) ;
- sujet à l'impératif-présent 3ᵉ personne : `Ajoute`, `Remplace`, `Reduit`,
  `Ouvre`, `Documente`. Une ligne, ~70 caractères, pas de point final ;
- corps en prose, qui dit **le problème d'avant** et la mesure ou l'observation
  qui a tranché, pas la liste des fichiers touchés — celle-là est dans le diff ;
- puces uniquement pour les points secondaires d'un changement à plusieurs
  volets, jamais comme corps entier ;
- les noms de code entre backticks, les libellés d'interface entre « guillemets
  français » ;
- trailers `Co-Authored-By:` et `Claude-Session:` de la session en cours.

Un commit par unité de sens. Si le travail couvre deux sujets réellement
séparables **par fichier**, faire deux commits. S'ils passent par les mêmes
fichiers, un seul commit qui expose les deux volets vaut mieux qu'un découpage
par hunk dont les états intermédiaires ne construisent pas — le dire alors dans
la réponse à l'utilisateur.

Passer le message par `git commit -F -` avec un heredoc : les guillemets
français et les tirets cadratins ne survivent pas à `-m` sous PowerShell.

## 4. Pousser

```bash
git add -A         # jamais .data/ : il est ignoré, le laisser ignoré
git commit -F - <<'EOF'
...
EOF
git push origin main
```

Les avertissements `LF will be replaced by CRLF` sont normaux sous Windows,
les ignorer.

Ne jamais toucher à la branche `remote-backup-*` : c'est une ligne de travail
divergente conservée à part.

## 5. Rendre compte

Dire ce qui a été poussé (`ancien..nouveau`), ce que le commit contient en trois
lignes, et **ce qui a été vérifié** — l'utilisateur ne voit pas la sortie des
commandes. Signaler tout code laissé sans appelant, et pourquoi.
