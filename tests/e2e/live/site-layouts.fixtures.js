// Seed novels for the daily site layout check (site-layouts.spec.js).
//
// Every supported site gets two or three real chapters. For each one the
// check loads the live page, runs the extension's own parsers against it, and
// compares the result with what is recorded here. `layout` lists the page
// elements the site's parser reads; if a site redesigns, those go missing (or
// the parsed values drift) and the check fails before readers notice.
//
// Expected values are exact strings unless they are a RegExp. Use a RegExp
// only where the site itself changes the text over time (Patreon moves posts
// between tiers and rewrites the "[T3]" suffix as it does).
//
// When a chapter disappears or a site renames one on purpose, re-run
// `npm run test:e2e:layouts`, confirm the new values in a browser, and update
// the entry.
//
// `unverified: true` marks entries that could not be loaded while they were
// written (the site blocked the author's network). The check still loads them
// but only asserts what the URL alone determines, plus that the parser
// produced a title and chapter label. Replace them with fully recorded entries
// the first time the scheduled run reaches the site.

export const SITE_LAYOUT_FIXTURES = [
  {
    site: "Royal Road",
    layout: [".fic-header h1", ".chapter-content"],
    novels: [
      {
        url: "https://www.royalroad.com/fiction/21220/mother-of-learning/chapter/301778/1-good-morning-brother",
        title: "Mother of Learning",
        novelHomeUrl: "https://www.royalroad.com/fiction/21220/mother-of-learning",
        lastReadChapterLabel: "1. Good Morning Brother"
      },
      {
        url: "https://www.royalroad.com/fiction/39408/beware-of-chicken/chapter/614481/chapter-1-he-bravely-turned-his-tail-and-fled",
        title: "Beware Of Chicken",
        novelHomeUrl: "https://www.royalroad.com/fiction/39408/beware-of-chicken",
        lastReadChapterLabel: "Chapter 1: He Bravely Turned His Tail and Fled"
      },
      {
        url: "https://www.royalroad.com/fiction/36049/the-primal-hunter/chapter/557051/chapter-1-another-monday-morning",
        title: "The Primal Hunter",
        novelHomeUrl: "https://www.royalroad.com/fiction/36049/the-primal-hunter",
        lastReadChapterLabel: "Chapter 1 - Another Monday morning"
      }
    ]
  },
  {
    site: "Patreon",
    layout: ["[data-tag='post-title']"],
    novels: [
      {
        url: "https://www.patreon.com/tedsteel/posts/dof-1-6-new-home-167109588",
        title: /^DoF 1\.6 - A New Home/,
        novelHomeUrl: "https://www.patreon.com/tedsteel/posts/dof-1-6-new-home-167109588",
        lastReadChapterLabel: /^DoF 1\.6 - A New Home/
      },
      {
        url: "https://www.patreon.com/tedsteel/posts/dof-1-7-buzzing-167546160",
        title: /^DoF 1\.7 - Buzzing/,
        novelHomeUrl: "https://www.patreon.com/tedsteel/posts/dof-1-7-buzzing-167546160",
        lastReadChapterLabel: /^DoF 1\.7 - Buzzing/
      }
    ]
  },
  {
    site: "Wuxiaworld",
    layout: ["[class*='-Chapter'] h4", ".chapter-content", "img[src*='/images/covers/']"],
    novels: [
      {
        url: "https://www.wuxiaworld.com/novel/coiling-dragon/cd-book-1-chapter-1",
        title: "Coiling Dragon",
        novelHomeUrl: "https://www.wuxiaworld.com/novel/coiling-dragon",
        lastReadChapterLabel: "Book 1, Chapter 1 – Early Morning at a Township"
      },
      {
        url: "https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-1",
        title: "Renegade Immortal",
        novelHomeUrl: "https://www.wuxiaworld.com/novel/renegade-immortal",
        lastReadChapterLabel: "Chapter 1 – Leaving Home"
      },
      {
        url: "https://www.wuxiaworld.com/novel/martial-world/mw-chapter-0",
        title: "Martial World",
        novelHomeUrl: "https://www.wuxiaworld.com/novel/martial-world",
        lastReadChapterLabel: "Chapter 0 - Magic Cube"
      }
    ]
  },
  {
    site: "NovelBin",
    layout: [".chr-title"],
    novels: [
      {
        unverified: true,
        url: "https://novelbin.com/b/shadow-slave/chapter-1-nightmare-begins",
        novelHomeUrl: "https://novelbin.com/b/shadow-slave"
      },
      {
        unverified: true,
        url: "https://novelbin.com/b/lord-of-the-mysteries/chapter-1-crimson",
        novelHomeUrl: "https://novelbin.com/b/lord-of-the-mysteries"
      }
    ]
  },
  {
    site: "ScribbleHub",
    layout: [".chapter-title", ".chp_raw"],
    novels: [
      {
        unverified: true,
        url: "https://www.scribblehub.com/read/2291530-scarlet-steel/chapter/2470326/",
        novelHomeUrl: "https://www.scribblehub.com/series/2291530/scarlet-steel/"
      }
    ]
  },
  {
    site: "Creative Novels",
    layout: ["h1"],
    novels: [
      {
        unverified: true,
        url: "https://creativenovels.com/302045/chapter-1-the-boy-the-world-forgot/",
        novelHomeUrl: "https://creativenovels.com/302045/"
      }
    ]
  },
  {
    site: "Light Novels Translations",
    layout: ["h1", ".text_story"],
    novels: [
      {
        url: "https://lightnovelstranslations.com/novel/ambition-of-oda-nobuna/volume-5-chapter-6-part-3/",
        title: "Ambition Of Oda Nobuna",
        novelHomeUrl: "https://lightnovelstranslations.com/novel/ambition-of-oda-nobuna/",
        lastReadChapterLabel: "Volume 5 Chapter 6 Part 3"
      },
      {
        url: "https://lightnovelstranslations.com/novel/nananas-buried-treasure/nananas-buried-treasure-volume-11-chapter-7-6/",
        title: "Nananas Buried Treasure",
        novelHomeUrl: "https://lightnovelstranslations.com/novel/nananas-buried-treasure/",
        lastReadChapterLabel: "Nanana’s Buried Treasure Volume 11 Chapter 7.6"
      }
    ]
  },
  {
    site: "Shin Translations",
    layout: ["h1", "a[href*='/series/']"],
    novels: [
      {
        url: "https://shintranslations.com/chapter/tng-vol-22-chapter-4-part-2/",
        title: "THE NEW GATE",
        novelHomeUrl: "https://shintranslations.com/series/the-new-gate-tng-toc/",
        lastReadChapterLabel: "TNG Vol. 22 Chapter 4 Part 2"
      },
      {
        url: "https://shintranslations.com/chapter/dar-vol-6-chapter-25-part-1/",
        title: "Starting a New Life for the Discarded All-Rounder",
        novelHomeUrl: "https://shintranslations.com/series/starting-a-new-life-for-the-discarded-all-rounder-dar/",
        lastReadChapterLabel: "DAR Vol. 6 Chapter 25 Part 1"
      },
      {
        url: "https://shintranslations.com/chapter/ternlf-vol-3-chapter-4-part-4/",
        title: "The Exiled Reincarnated Noble Lives Freely",
        novelHomeUrl: "https://shintranslations.com/series/the-exiled-reincarnated-noble-lives-freely-ternlf/",
        lastReadChapterLabel: "TERNLF Vol. 3 Chapter 4 Part 4"
      }
    ]
  },
  {
    site: "Chikari",
    // The reader hydrates client-side and its two routes share no markup, so
    // each seeded chapter names the element that proves it rendered.
    layout: [],
    novels: [
      {
        url: "https://chikari.moe/novels/a-regressors-tale-of-cultivation/2",
        title: "A Regressor’s Tale of Cultivation",
        novelHomeUrl: "https://chikari.moe/novels/a-regressors-tale-of-cultivation",
        lastReadChapterLabel: "Chapter 1: Regressors First Day",
        ready: "main header p"
      },
      {
        url: "https://chikari.moe/series/omniscient-reader/8",
        title: "Omniscient Reader",
        novelHomeUrl: "https://chikari.moe/series/omniscient-reader",
        lastReadChapterLabel: "Chapter 8",
        ready: "img[alt='Page 1']"
      }
    ]
  },
  {
    site: "Archive of Our Own",
    layout: ["h2.title.heading", "#chapters .chapter.preface h3.title"],
    novels: [
      {
        url: "https://archiveofourown.org/works/10057010/chapters/22409387?view_adult=true",
        title: "All the Young Dudes",
        novelHomeUrl: "https://archiveofourown.org/works/10057010",
        lastReadChapterLabel: "Chapter 1: Summer, 1971: St Edmund's"
      },
      {
        url: "https://archiveofourown.org/works/34500952/chapters/85870951?view_adult=true",
        title: "Draco Malfoy and the Mortifying Ordeal of Being in Love",
        novelHomeUrl: "https://archiveofourown.org/works/34500952",
        lastReadChapterLabel: "Chapter 2: Draco Malfoy, Genius Inventor"
      },
      {
        url: "https://archiveofourown.org/works/20049589/chapters/47480461?view_adult=true",
        title: "Evitative",
        novelHomeUrl: "https://archiveofourown.org/works/20049589",
        lastReadChapterLabel: "Chapter 1: The Library"
      }
    ]
  },
  {
    site: "Wattpad",
    layout: ["h2.title", "h1.h2", "img.cover"],
    novels: [
      {
        url: "https://www.wattpad.com/235603347-empire-of-ashes-preview",
        title: "Empire of Ashes",
        novelHomeUrl: "https://www.wattpad.com/story/66766637-empire-of-ashes",
        lastReadChapterLabel: "Preview"
      },
      {
        url: "https://www.wattpad.com/277284720-smoke-and-mirrors-royal-angels-i-trailer-and",
        title: "Smoke and Mirrors : Royal Angels I",
        novelHomeUrl: "https://www.wattpad.com/story/70952242-smoke-and-mirrors-royal-angels-i",
        lastReadChapterLabel: "Trailer and Copyright"
      },
      {
        url: "https://www.wattpad.com/20381849-death-is-my-friend-with-benefits-book-four-wa",
        title: "Death Is My Friend with Benefits (Book Four - WA Winner 2013)",
        novelHomeUrl: "https://www.wattpad.com/story/3062367-death-is-my-friend-with-benefits-book-four-wa",
        lastReadChapterLabel: "All Rights Reserved"
      }
    ]
  },
  {
    site: "Webnovel",
    layout: [".cha-tit h1", "[data-cid]"],
    novels: [
      {
        url: "https://www.webnovel.com/book/shadow-slave_22196546206090805/nightmare-begins_59583457017254387",
        title: "Shadow Slave",
        novelHomeUrl: "https://www.webnovel.com/book/shadow-slave_22196546206090805",
        lastReadChapterLabel: "Chapter 1: Nightmare Begins"
      },
      {
        url: "https://www.webnovel.com/book/supreme-magus_12820870105509205/a-new-beginning_34415834751367671",
        title: "Supreme Magus",
        novelHomeUrl: "https://www.webnovel.com/book/supreme-magus_12820870105509205",
        lastReadChapterLabel: "Chapter 1: A New Beginning"
      },
      {
        url: "https://www.webnovel.com/book/the-innkeeper_22426985405158405/a-shooting-star-and-a-wish_60202087178355517",
        title: "The Innkeeper",
        novelHomeUrl: "https://www.webnovel.com/book/the-innkeeper_22426985405158405",
        lastReadChapterLabel: "Chapter 1: A shooting star and a wish"
      }
    ]
  },
  {
    site: "NovelFire",
    layout: [".booktitle", ".chapter-title", "#content"],
    novels: [
      {
        url: "https://novelfire.net/book/shadow-slave/chapter-1",
        title: "Shadow Slave",
        novelHomeUrl: "https://novelfire.net/book/shadow-slave",
        lastReadChapterLabel: "Chapter 1 - 1: Nightmare Begins"
      },
      {
        url: "https://novelfire.net/book/lord-of-the-mysteries/chapter-1",
        title: "Lord of the Mysteries",
        novelHomeUrl: "https://novelfire.net/book/lord-of-the-mysteries",
        lastReadChapterLabel: "Chapter 1 - Crimson"
      },
      {
        url: "https://novelfire.net/book/the-legendary-mechanic/chapter-1",
        title: "The Legendary Mechanic",
        novelHomeUrl: "https://novelfire.net/book/the-legendary-mechanic",
        lastReadChapterLabel: "Chapter 1 - Rebirth"
      }
    ]
  },
  {
    site: "ReadNovelFull",
    layout: [".novel-title", ".chr-title", "#chr-content"],
    novels: [
      {
        url: "https://readnovelfull.com/second-world/chapter-1-1-beta-test.html",
        title: "Second World",
        novelHomeUrl: "https://readnovelfull.com/second-world.html",
        lastReadChapterLabel: "Chapter 1 - 1. Beta Test"
      },
      {
        url: "https://readnovelfull.com/the-innkeeper/chapter-1-a-shooting-star-and-a-wish.html",
        title: "The Innkeeper",
        novelHomeUrl: "https://readnovelfull.com/the-innkeeper.html",
        lastReadChapterLabel: "Chapter 1 A shooting star and a wish"
      },
      {
        url: "https://readnovelfull.com/the-golem-mage/chapter-1206-invading-groups-2.html",
        title: "The Golem Mage",
        novelHomeUrl: "https://readnovelfull.com/the-golem-mage.html",
        lastReadChapterLabel: "Chapter 1206: Invading Groups [2]."
      }
    ]
  }
];
