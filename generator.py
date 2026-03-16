#!/usr/bin/env python3
"""
Générateur de puzzle quotidien pour PokepediaTIx
Tous les mots sont masqués au départ.
"""

import requests
import hashlib
import json
import re
import random
import unicodedata
from datetime import datetime
from html.parser import HTMLParser
from typing import List, Dict, Any, Set, Optional

# Tentative d'import des librairies de similarité
try:
    from sentence_transformers import SentenceTransformer, util
    HAS_EMBEDDINGS = True
except ImportError:
    HAS_EMBEDDINGS = False
    print("Note: sentence-transformers non installé")

# Tentative d'import de BeautifulSoup
try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False
    print("Note: beautifulsoup4 non installé, utilisation du parser basique")

# Configuration
BASE_URL = "https://www.pokepedia.fr"
API_URL = f"{BASE_URL}/api.php"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; PokepediaTIx/1.0)"}

# Catégories
WIKI_CATEGORIES = ["Catégorie:Lieu", "Catégorie:Objet", "Catégorie:Attaque", "Catégorie:Talent", "Catégorie:Région"]
POKEMON_CATEGORIES = ["Catégorie:Pokémon"]


def normalize_text(text: str) -> str:
    text = text.lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text


def get_pages_from_category(category: str) -> List[str]:
    params = {
        "action": "query", "list": "categorymembers",
        "cmtitle": category, "cmlimit": 500, "cmtype": "page", "format": "json"
    }
    try:
        response = requests.get(API_URL, params=params, headers=HEADERS, timeout=30)
        data = response.json()
        if "query" in data and "categorymembers" in data["query"]:
            return [page["title"] for page in data["query"]["categorymembers"]]
    except:
        pass
    return []


def fetch_page_html(title: str) -> str:
    url = f"{BASE_URL}/{title.replace(' ', '_')}"
    try:
        response = requests.get(url, headers=HEADERS, timeout=30)
        return response.text
    except:
        return ""


class InfoboxParser(HTMLParser):
    """Parse l'infobox d'une page Pokémon."""
    def __init__(self):
        super().__init__()
        self.in_infobox = False
        self.in_row = False
        self.in_th = False
        self.in_td = False
        self.current_label = ""
        self.current_value = ""
        self.data = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        class_attr = attrs_dict.get("class", "").lower()

        if tag == "table" and ("infobox" in class_attr or "pokemon" in class_attr):
            self.in_infobox = True
            self.depth = 1
        elif self.in_infobox:
            if tag == "table":
                self.depth += 1
            elif tag == "tr":
                self.in_row = True
                self.current_label = ""
                self.current_value = ""
            elif tag == "th" and self.in_row:
                self.in_th = True
            elif tag == "td" and self.in_row:
                self.in_td = True

    def handle_endtag(self, tag):
        if self.in_infobox:
            if tag == "table":
                self.depth -= 1
                if self.depth <= 0:
                    self.in_infobox = False
            elif tag == "tr" and self.in_row:
                label = re.sub(r'\s+', ' ', self.current_label).strip()
                value = re.sub(r'\s+', ' ', self.current_value).strip()
                if label and value and len(label) < 40 and len(value) < 150:
                    self.data.append({"label": label, "value": value})
                self.in_row = False
            elif tag == "th":
                self.in_th = False
            elif tag == "td":
                self.in_td = False

    def handle_data(self, data):
        if self.in_th:
            self.current_label += data
        elif self.in_td:
            self.current_value += data


class ContentParser(HTMLParser):
    """Parse le contenu principal d'une page."""
    def __init__(self, first_only=False):
        super().__init__()
        self.in_content = False
        self.content_depth = 0
        self.skip_depth = 0
        self.skip_tags = {"table", "script", "style", "sup", "figure", "nav", "aside"}
        self.skip_classes = {"infobox", "navbox", "toc", "thumb", "gallery", "mw-editsection", "reference", "catlinks"}
        self.elements = []
        self.current_text = ""
        self.current_type = None
        self.first_only = first_only
        self.para_count = 0

    def _flush(self):
        text = re.sub(r'\s+', ' ', self.current_text).strip()
        text = re.sub(r'\[\d+\]', '', text)
        text = re.sub(r'\[modifier[^\]]*\]', '', text)
        if text and len(text) > 10:
            if self.current_type == "heading":
                if text.lower() not in ("voir aussi", "références", "notes", "liens externes"):
                    self.elements.append({"type": "heading", "level": 2, "content": text})
            else:
                self.elements.append({"type": "paragraph", "content": text})
                self.para_count += 1
        self.current_text = ""
        self.current_type = None

    def handle_starttag(self, tag, attrs):
        if self.first_only and self.para_count >= 1:
            return

        attrs_dict = dict(attrs)
        class_attr = attrs_dict.get("class", "").lower()

        if "mw-parser-output" in class_attr:
            self.in_content = True
            self.content_depth = 1
            return

        if not self.in_content:
            return

        self.content_depth += 1

        if tag in self.skip_tags or any(sc in class_attr for sc in self.skip_classes):
            self.skip_depth += 1
            return

        if self.skip_depth > 0:
            return

        if tag in ("h2", "h3", "h4"):
            self._flush()
            self.current_type = "heading"
        elif tag == "p":
            self._flush()
            self.current_type = "paragraph"

    def handle_endtag(self, tag):
        if not self.in_content:
            return

        self.content_depth -= 1
        if self.content_depth <= 0:
            self._flush()
            self.in_content = False
            return

        if tag in self.skip_tags:
            self.skip_depth = max(0, self.skip_depth - 1)
            return

        if self.skip_depth > 0:
            return

        if tag in ("h2", "h3", "h4", "p"):
            self._flush()

    def handle_data(self, data):
        if self.first_only and self.para_count >= 1:
            return
        if self.in_content and self.skip_depth == 0:
            self.current_text += data


def extract_infobox(html: str) -> List[Dict[str, str]]:
    """Extrait l'infobox."""
    if HAS_BS4:
        try:
            soup = BeautifulSoup(html, 'html.parser')
            infobox = soup.find('table', class_=lambda x: x and 'infobox' in str(x).lower())
            if not infobox:
                infobox = soup.find('table', class_=lambda x: x and 'pokemon' in str(x).lower())
            if not infobox:
                return []

            data = []
            for row in infobox.find_all('tr'):
                th = row.find('th')
                td = row.find('td')
                if th and td:
                    label = re.sub(r'\s+', ' ', th.get_text(strip=True))
                    value = re.sub(r'\s+', ' ', td.get_text(separator=' ', strip=True))
                    if label and value and len(label) < 40 and len(value) < 150:
                        if not any(x in label.lower() for x in ['modifier', 'image', 'artwork']):
                            data.append({"label": label, "value": value})
            return data[:20]
        except:
            pass

    # Fallback: parser HTML basique
    parser = InfoboxParser()
    try:
        parser.feed(html)
    except:
        pass
    return parser.data[:20]


def extract_content(html: str, first_only: bool = False) -> List[Dict[str, Any]]:
    """Extrait le contenu structuré."""
    if HAS_BS4:
        try:
            soup = BeautifulSoup(html, 'html.parser')
            content = soup.find('div', class_='mw-parser-output')
            if not content:
                return []

            elements = []
            para_count = 0

            for elem in content.children:
                if first_only and para_count >= 1:
                    break

                if not hasattr(elem, 'name') or not elem.name:
                    continue

                # Skip tables, navbox, etc.
                if elem.name in ['table', 'div', 'figure', 'style', 'script']:
                    classes = ' '.join(elem.get('class', []))
                    if any(x in classes.lower() for x in ['infobox', 'navbox', 'toc', 'thumb', 'gallery']):
                        continue
                    if elem.name in ['table', 'div', 'figure']:
                        continue

                if elem.name in ['h2', 'h3', 'h4']:
                    text = elem.get_text(strip=True)
                    text = re.sub(r'\[modifier[^\]]*\]', '', text).strip()
                    if text and text.lower() not in ['voir aussi', 'références', 'notes', 'liens externes']:
                        elements.append({"type": "heading", "level": int(elem.name[1]), "content": text})

                elif elem.name == 'p':
                    text = elem.get_text(strip=True)
                    text = re.sub(r'\[\d+\]', '', text)
                    text = re.sub(r'\s+', ' ', text).strip()
                    if len(text) > 20:
                        elements.append({"type": "paragraph", "content": text})
                        para_count += 1

                elif elem.name in ['ul', 'ol']:
                    items = []
                    for li in elem.find_all('li', recursive=False):
                        item_text = li.get_text(strip=True)
                        item_text = re.sub(r'\[\d+\]', '', item_text).strip()
                        if len(item_text) > 3:
                            items.append(item_text)
                    if items:
                        elements.append({"type": "list", "items": items})

            return elements
        except:
            pass

    # Fallback
    parser = ContentParser(first_only)
    try:
        parser.feed(html)
    except:
        pass
    return parser.elements


def extract_categories(html: str) -> List[str]:
    categories = []
    for match in re.finditer(r'title="Catégorie:([^"]+)"', html):
        cat = match.group(1)
        if len(cat) < 50:
            categories.append(cat)
    return categories[:5]


def tokenize_text(text: str) -> List[Dict[str, Any]]:
    """Tokenise - TOUS les mots masqués."""
    tokens = []
    for match in re.finditer(r"(\w+|[^\w\s]+|\s+)", text, re.UNICODE):
        token = match.group(0)
        if token.strip() == "":
            tokens.append({"type": "newline" if "\n" in token else "space", "value": " ", "revealed": True})
        elif re.match(r"^\w+$", token, re.UNICODE):
            tokens.append({
                "type": "word",
                "value": token,
                "normalized": normalize_text(token),
                "revealed": False,
                "length": len(token)
            })
        else:
            tokens.append({"type": "punctuation", "value": token, "revealed": True})
    return tokens


def structure_to_tokens(elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tokens = []
    for elem in elements:
        if elem["type"] == "heading":
            tokens.append({"type": "section_start", "level": elem.get("level", 2), "revealed": True})
            tokens.extend(tokenize_text(elem["content"]))
            tokens.append({"type": "section_end", "revealed": True})
        elif elem["type"] == "paragraph":
            tokens.append({"type": "paragraph_start", "revealed": True})
            tokens.extend(tokenize_text(elem["content"]))
            tokens.append({"type": "paragraph_end", "revealed": True})
        elif elem["type"] == "list":
            tokens.append({"type": "list_start", "revealed": True})
            for item in elem["items"]:
                tokens.append({"type": "list_item_start", "revealed": True})
                tokens.extend(tokenize_text(item))
                tokens.append({"type": "list_item_end", "revealed": True})
            tokens.append({"type": "list_end", "revealed": True})
    return tokens


def infobox_to_tokens(infobox: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    tokens = []
    for item in infobox:
        tokens.append({"type": "infobox_row_start", "revealed": True})
        tokens.append({"type": "infobox_label_start", "revealed": True})
        tokens.extend(tokenize_text(item["label"]))
        tokens.append({"type": "infobox_label_end", "revealed": True})
        tokens.append({"type": "infobox_value_start", "revealed": True})
        tokens.extend(tokenize_text(item["value"]))
        tokens.append({"type": "infobox_value_end", "revealed": True})
        tokens.append({"type": "infobox_row_end", "revealed": True})
    return tokens


def add_image_placeholders(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result = []
    para_count = 0
    for token in tokens:
        result.append(token)
        if token["type"] == "paragraph_end":
            para_count += 1
            if para_count in (1, 4):
                result.append({"type": "image_placeholder", "revealed": True})
    return result


# ============================================================================
# SÉLECTION ET GÉNÉRATION
# ============================================================================

def select_page(categories: List[str], min_chars: int = 200) -> Optional[Dict[str, Any]]:
    all_pages = []
    for cat in categories:
        print(f"  {cat}...")
        pages = get_pages_from_category(cat)
        all_pages.extend([p for p in pages if not p.startswith("Catégorie:")])
        print(f"    -> {len(pages)} pages")

    if not all_pages:
        return None

    all_pages = list(set(all_pages))
    print(f"Total: {len(all_pages)}")
    random.shuffle(all_pages)

    for i, title in enumerate(all_pages[:60]):
        print(f"  [{i+1}] {title}", end="")
        html = fetch_page_html(title)
        if len(html) < 1000:
            print(" - trop court")
            continue

        content = extract_content(html, first_only=True)
        if not content:
            print(" - pas de contenu")
            continue

        first_para = content[0].get("content", "") if content else ""
        if len(first_para) < min_chars:
            print(f" - para court ({len(first_para)})")
            continue

        infobox = extract_infobox(html)
        full_content = extract_content(html, first_only=False)
        cats = extract_categories(html)

        print(f" - OK ({len(first_para)} chars, {len(infobox)} infos)")
        return {
            "title": title,
            "first_paragraph": first_para,
            "content": full_content,
            "infobox": infobox,
            "categories": cats
        }

    return None


def generate_pokemon_puzzle() -> Dict[str, Any]:
    print("\n=== POKÉMON ===")
    page = select_page(POKEMON_CATEGORIES, min_chars=100)
    if not page:
        raise Exception("Pas de page Pokémon trouvée")

    title = page["title"]
    print(f"\n-> {title}")

    # Premier paragraphe
    para_tokens = tokenize_text(page["first_paragraph"])
    tokens = [{"type": "paragraph_start", "revealed": True}] + para_tokens + [{"type": "paragraph_end", "revealed": True}]

    # Infobox
    infobox_tokens = infobox_to_tokens(page["infobox"])

    title_tokens = tokenize_text(title)
    all_tokens = tokens + infobox_tokens
    total_words = sum(1 for t in all_tokens if t.get("type") == "word")

    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "mode": "pokemon",
        "titleHash": hashlib.sha256(title.lower().encode()).hexdigest(),
        "titleTokens": title_tokens,
        "titleLength": len(title),
        "tokens": tokens,
        "infoboxTokens": infobox_tokens,
        "stats": {"totalWords": total_words, "hiddenWords": total_words},
        "categories": page["categories"],
        "hint": {"firstLetter": title[0].upper(), "wordCount": sum(1 for t in title_tokens if t["type"] == "word")},
        "semanticHints": {}
    }


def generate_wiki_puzzle() -> Dict[str, Any]:
    print("\n=== WIKI ===")
    page = select_page(WIKI_CATEGORIES, min_chars=300)
    if not page:
        raise Exception("Pas de page Wiki trouvée")

    title = page["title"]
    print(f"\n-> {title}")

    tokens = structure_to_tokens(page["content"])
    tokens = add_image_placeholders(tokens)
    title_tokens = tokenize_text(title)
    total_words = sum(1 for t in tokens if t.get("type") == "word")

    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "mode": "wiki",
        "titleHash": hashlib.sha256(title.lower().encode()).hexdigest(),
        "titleTokens": title_tokens,
        "titleLength": len(title),
        "tokens": tokens,
        "stats": {"totalWords": total_words, "hiddenWords": total_words},
        "categories": page["categories"],
        "hint": {"firstLetter": title[0].upper(), "wordCount": sum(1 for t in title_tokens if t["type"] == "word")},
        "semanticHints": {}
    }


def save_puzzle(puzzle: Dict[str, Any], path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(puzzle, f, ensure_ascii=False, indent=2)
    print(f"Sauvé: {path}")


if __name__ == "__main__":
    import sys

    random.seed(int(datetime.now().strftime('%Y%m%d')))

    try:
        pokemon = generate_pokemon_puzzle()
        save_puzzle(pokemon, "public/pokemon_puzzle.json")
        print(f"  {pokemon['stats']['hiddenWords']} mots")

        wiki = generate_wiki_puzzle()
        save_puzzle(wiki, "public/wiki_puzzle.json")
        print(f"  {wiki['stats']['hiddenWords']} mots")

        print("\nTerminé!")
    except Exception as e:
        print(f"Erreur: {e}")
        sys.exit(1)
