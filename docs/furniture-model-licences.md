# Furniture model licences

Research for US-13, done on 2026-10-27. It answers two questions: which free 3D furniture models may this app use, and what does the app have to say about them?

## Result

All 15 furniture types use models from one pack, **Furniture Kit 2.0 by Kenney**, released under **CC0**. CC0 means the author gave up all rights: the files may be sent to visitors, changed and used commercially, and **no credit is required**. The credits section (US-28) still names Kenney, because the author asks for it kindly.

Why this pack and not another:

- **It covers every type.** Poly Haven, the other large CC0 source, has no rug, no floor lamp and no TV stand (only televisions). KayKit has no desk or office chair. Kenney has all 15, though the dresser is only a stand-in (see below).
- **The files are ready to use.** Each chosen model is a single `.glb` of 3 to 38 KB, about 200 KB for all 15, far under the 2 MB limit in US-14.
- **One look.** All models share one low-poly style, so the room does not look like a mix of sources.
- **Easy to recolour.** The models use flat, named colours and no textures, so US-17 can change one material by name.

The price is a stylised look: simple low-poly shapes, not photographs. That fits US-16, which is about checking that the app understood the furniture, not about drawing a realistic room.

## What a licence has to allow

The app is a website, so every model file is sent to each visitor's browser as a file of its own, and later stories change the models. A licence is accepted only if it allows all of these:

1. **Giving the file to visitors.** The model is served as a plain `.glb` that anyone can save.
2. **Changing it.** The models are rescaled, moved onto the floor, converted, compressed and recoloured (US-14, US-16, US-17).
3. **Commercial use**, in case the app is published beyond a course project.
4. **Conditions the app can meet.** A credit is fine, because US-28 has a credits section. Share-alike (SA), no-derivatives (ND) and non-commercial (NC) conditions are not.

In practice this accepts **CC0** (no conditions) and **CC BY** (credit required), and rejects everything else, including licences that could not be read.

Condition 1 is what rules out most marketplaces: their "royalty free" licences let a model be used inside a finished product, but not handed over as a file.

## Libraries checked

| Library | Licence | Credit required | File formats | Can this app use it? |
| --- | --- | --- | --- | --- |
| [Kenney](https://kenney.nl/assets/furniture-kit) | CC0 | No (asked, not mandatory) | GLB, FBX, OBJ, DAE, STL | **Yes. Chosen** |
| [KayKit Furniture Bits](https://kaylousberg.itch.io/furniture-bits) | CC0 | No (asked, not mandatory) | glTF (+ .bin), FBX, OBJ | Yes. Kept as an upgrade for the dresser |
| [Poly Haven](https://polyhaven.com/license) | CC0 | No (appreciated) | glTF (.gltf + .bin + textures), Blender, FBX, USD | Yes, for single pieces. Not the main source: gaps, mixed styles, large files |
| [Quaternius](https://quaternius.com/packs/furniture.html) | CC0 | No | FBX, OBJ, Blend (no glTF on its two furniture packs) | Yes, but it needs conversion and adds nothing the Kenney kit lacks |
| [Poly Pizza](https://poly.pizza/docs/tos) | A Creative Commons licence, set per model (CC0 on the one checked) | Depends on the licence | glTF download | Only CC0 or CC BY models. Not needed: much of its furniture is Kenney's and Quaternius's |
| [OpenGameArt](https://opengameart.org/content/faq) | Set per asset: CC0, CC BY, CC BY-SA, OGA-BY, GPL | Yes, except CC0 | Varies | Only CC0, CC BY or OGA-BY assets. Not needed |
| [Sketchfab](https://help.sketchfab.com/en/articles/16152217) | Set per model: Standard, or Creative Commons (CC0, BY, BY-SA, BY-ND, BY-NC) | Yes for every Creative Commons licence except CC0 | glTF, GLB (several texture sizes), USDZ, the original upload. Login needed | Only CC0 and CC BY models. Never Standard |
| [BlenderKit](https://www.blenderkit.com/docs/licenses/) | Royalty Free or CC0, set per asset | Not for Royalty Free | Through the Blender add-on | No |
| [TurboSquid](https://blog.turbosquid.com/turbosquid-3d-model-license/), free models | Royalty Free | No | Varies | **No.** The model file may not be given to others |
| [CGTrader](https://www.cgtrader.com/pages/terms-and-conditions), free models | Royalty Free | No | Varies | **No.** The model must not be extractable |
| [Fab](https://www.fab.com/eula) | Standard licence and others | Not verified | Not verified | **No.** Licence text could not be read |
| [Free3D](https://free3d.com/) | Set by the uploader, under a Royalty Free platform licence | Not verified | Varies | **No.** Terms could not be read |
| Google Poly | n/a | n/a | n/a | Closed: downloads were switched off on 30 June 2021 |
| [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | Set per model | Per model | glTF | No. Test models for glTF viewers, not furniture |

### Notes on the libraries

- **Kenney.** The pack's own `License.txt` says: "This content is free to use in personal, educational and commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)". Kenney's site (`kenney.nl/support`) says the same and asks that its logo is not used. The zip holds 140 models in five formats; the GLB files total 1.87 MB, and the largest is 70 KB.
- **KayKit.** Its `LICENSE.txt` in the [GitHub repository](https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0) says CC0 and that credit is not mandatory. The repository has 53 models that share one 1024 × 1024 texture. It does include a real chest of drawers (`cabinet_medium`), which the Kenney kit does not.
- **Poly Haven.** Everything is CC0 ("Our assets are all licensed as CC0", "You do not need to give credit"). Its catalogue has 521 models, 85 tagged furniture, with chairs, sofas, tables, beds, shelves and cabinets, but no rug, floor lamp or TV stand. Downloads are glTF packages (a `.gltf`, a `.bin` and texture files) at 1k to 8k texture sizes. Of 23 models measured, 17 are under 2 MB with 1k textures (the range is 0.4 to 3.9 MB), and none are under 2 MB at 4k (the smallest is 3.9 MB). It is a good source for one realistic piece, not for the whole set.
- **Sketchfab.** Its licence page covers only the Standard and Editorial licences. Standard section 2.2(b) forbids making a model available "as a stand-alone file", which is what a website does when it sends a `.glb`, so Standard models are out. Among the Creative Commons models, CC0 and CC BY are fine; BY-NC (no commercial use), BY-ND (no changes, and rescaling is a change) and BY-SA (changes must be shared alike) are out. Epic opened its Fab marketplace in October 2024 and said then that free downloadable models stay on Sketchfab, with notice before that ends. Nothing newer that gives an end date turned up. If a Sketchfab model is ever used, keep its file and a note of its page, author and licence on the day of download; Sketchfab's help says the licence a model had when it was downloaded stays valid even if the author changes it later.
- **TurboSquid and CGTrader.** Both are royalty free for use inside a finished product, not for giving the model away. TurboSquid: "Giving away the 3D Model file itself is not allowed", and models "must be contained in proprietary formats so that they cannot be opened or imported". CGTrader: only an "Incorporated Product" that "cannot be extracted from an application or other product". A `.glb` on a website is an open, downloadable file. Free models carry the same licence as paid ones.
- **BlenderKit.** The Royalty Free licence does not allow selling an asset as it is, and for games the assets should not be directly extractable; downloads go through the Blender add-on. Its licence page now redirects to a different domain (`blendkit.com`), which I did not follow, so this row rests on a search summary of its licensing FAQ and not on the page itself.
- **Fab and Free3D.** Both refused automated access (HTTP 403), so their licence texts could not be read. A summary of Fab's Standard licence says content can be used commercially and changed but not redistributed on its own, and a third-party summary says that Free3D's original files may not be redistributed. A web app does exactly that, and nothing could be confirmed from the licence texts, so neither is used.

## Chosen models

All 15 are from the Kenney Furniture Kit (2.0, CC0), in `Models/GLTF format/<name>.glb`. Sizes are measured from the files, in cm (width × depth × height), and are the size inside the file, not the real size (see below).

| Type | Model | File size | Size in the file | Note |
| --- | --- | --- | --- | --- |
| `sofa` | `loungeSofa` | 9 KB | 98 × 41 × 46 | |
| `armchair` | `loungeChair` | 9 KB | 49 × 41 × 46 | |
| `coffee_table` | `tableCoffee` | 8 KB | 66 × 40 × 23 | |
| `side_table` | `sideTable` | 9 KB | 53 × 22 × 38 | Long and narrow, like a console table; a typical side table is squarer |
| `dining_table` | `table` | 8 KB | 84 × 45 × 33 | |
| `dining_chair` | `chair` | 11 KB | 20 × 20 × 47 | |
| `bed` | `bedDouble` | 23 KB | 96 × 113 × 38 | |
| `nightstand` | `cabinetBedDrawer` | 16 KB | 27 × 22 × 26 | |
| `dresser` | `cabinetTelevisionDoors` | 16 KB | 80 × 26 × 31 | **Stand-in.** The kit has no chest of drawers; this is a low wide wooden cabinet with doors |
| `bookshelf` | `bookcaseOpen` | 18 KB | 40 × 25 × 88 | |
| `tv_stand` | `cabinetTelevision` | 10 KB | 80 × 25 × 31 | |
| `desk` | `desk` | 15 KB | 73 × 39 × 38 | |
| `office_chair` | `chairDesk` | 38 KB | 33 × 31 × 61 | The only model with a swivel base |
| `floor_lamp` | `lampRoundFloor` | 6 KB | 15 × 18 × 86 | |
| `rug` | `rugRectangle` | 3 KB | 157 × 92 × 1 | |

Other models in the same pack, with the same licence, for later: `loungeDesignSofa`, `loungeDesignChair`, `loungeChairRelax`, `tableCoffeeSquare`, `tableCoffeeGlass`, `tableGlass`, `tableCross`, `chairCushion`, `chairRounded`, `chairModernCushion`, `bedSingle`, `cabinetBed`, `sideTableDrawers`, `bookcaseClosed`, `bookcaseClosedWide`, `bookcaseOpenLow`, `lampSquareFloor`, `rugRound`, `rugRounded` and `rugSquare`. The glass tables are a ready-made look for the `glass` material.

If the dresser stand-in looks wrong in the room, the upgrade is KayKit's `cabinet_medium` (CC0, 200 × 100 × 100 in its own units). It costs a second source to credit, a step to pack its `.gltf`, `.bin` and texture into one `.glb`, and a different way to colour it: it uses one shared texture, so US-17 could only tint it, not change a named material.

## What this means for the later stories

Found while choosing, so it does not have to be found twice:

- **Scale (US-14).** The Kenney models are about half real size: the sofa is 98 cm wide in the file, the bed 96 × 113 cm. Multiplying by about 2 gives believable sizes (a 196 cm sofa, a 192 × 226 cm bed). US-14 AC2 asks for real-world size, so each model's scale goes in the library index. *Done in US-14:* each file is scaled so that it comes as close as possible to the typical size of its type (the factors are between 1.3 and 2.2, not a flat 2), and the index says by how much.
- **Origin (US-14).** A model's origin is at a corner or off to one side of its footprint, not at its middle (the sofa's middle is 49 cm to the side and 21 cm back from the origin). Models need re-centring before they are placed. All 15 chosen models stand on the floor already (their base is at height 0). The pack's `tableRound` does not (its base is 27 cm below the origin), which is one reason it was not chosen. *Done in US-14:* every file has its base on the floor and the middle of its footprint at the origin.
- **Colour (US-17).** The models use flat colours, no textures, with one to four named materials each: `wood`, `carpet` (upholstery and fabric), `metal`, `glass`, and variants such as `carpetWhite` and `metalMedium`. US-14's index should record which material is the main surface for each type. *Done in US-14:* the index gives `main_material` and lists all the materials of each model.
- **Which way a model faces** was not checked here. US-14 has to fix it and record it, because the rotation rule in US-20 depends on it. *Done in US-14:* all 15 models were looked at from the front and from behind, and every one already faces +z, the front of the room. The tests keep it so for the types that have a clear front (seats and beds have their backs at -z, and drawers and desks have their handles at +z).
- **Licence file (US-14).** Keep the pack's `License.txt` next to the model files. *Done in US-14:* it is `public/models/LICENSE-kenney-furniture-kit.txt`.

## Credits

No credit is required. Both authors ask for one, so the credits section in US-28 should list:

> Furniture models: "Furniture Kit" by Kenney (www.kenney.nl), CC0 1.0.

If KayKit's dresser is used later, add:

> Dresser model: "Furniture Bits" by Kay Lousberg (www.kaylousberg.com), CC0 1.0.

If a CC BY model is ever added, a credit is required. CC BY says to "give appropriate credit, provide a link to the license, and indicate if changes were made". Creative Commons recommends four parts (title, author, source link, licence link), shown where visitors can see them; metadata alone is not enough. For example:

> "Chair" by Jane Doe (https://example.com/chair), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Rescaled and converted to GLB.

## How this was checked

- Each licence page linked above was read on 2026-10-27, and the quotes are from those pages. This is a reading of public licence terms, not legal advice.
- The Kenney Furniture Kit zip (5.1 MB) was downloaded and unpacked outside the project. Its `License.txt` was read, and all 140 `.glb` files were measured from their headers. The kit's page says version 1.0 and the zip's licence file says 2.0; the contents are the 140 models the page lists. Nothing was loaded into the app and no model file was added to the project; that is US-14.
- KayKit's `LICENSE.txt` was read, and 11 of its models were measured from the repository.
- Poly Haven's catalogue and glTF download sizes came from its public API (`api.polyhaven.com`).
- Not read: Fab and Free3D (HTTP 403), the BlenderKit licence page (redirect to another domain), and any Sketchfab plan newer than October 2024.
