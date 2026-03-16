import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// Normalise le texte
function normalizeText(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Composant Mot
function Word({ token, isTitle, isHeading, semanticScore }) {
  if (semanticScore !== undefined && semanticScore > 0 && !token.revealed) {
    const opacity = 0.4 + (semanticScore * 0.5);
    const percentage = Math.round(semanticScore * 100);
    return (
      <span className={`word semantic ${isTitle ? 'title-word' : ''}`} style={{ opacity }} title={`${percentage}%`}>
        {token.value}
        <span className="semantic-score">{percentage}%</span>
      </span>
    );
  }
  if (token.revealed) {
    return <span className={`word revealed ${isTitle ? 'title-word' : ''} ${isHeading ? 'heading-word' : ''}`}>{token.value}</span>;
  }
  const width = Math.max(token.length * 0.65, 1);
  return <span className={`word hidden ${isTitle ? 'title-word' : ''}`} style={{ width: `${width}em` }} title={`${token.length} lettres`} />;
}

// Image masquée
function ImagePlaceholder() {
  return (
    <div className="image-placeholder">
      <div className="image-placeholder-icon">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
        </svg>
      </div>
    </div>
  );
}

// Rendu token
function renderToken(token, key, isHeading, semanticReveals) {
  switch (token.type) {
    case 'word':
      return <Word key={key} token={token} isHeading={isHeading} semanticScore={semanticReveals[token.normalized]} />;
    case 'space':
      return <span key={key} className="space"> </span>;
    case 'newline':
      return <br key={key} />;
    case 'punctuation':
      return <span key={key} className="punctuation">{token.value}</span>;
    default:
      return null;
  }
}

// Contenu structuré
function StructuredContent({ tokens, semanticReveals }) {
  const elements = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    switch (token.type) {
      case 'section_start': {
        const level = token.level;
        const headingTokens = [];
        i++;
        while (i < tokens.length && tokens[i].type !== 'section_end') {
          headingTokens.push(tokens[i]);
          i++;
        }
        const HeadingTag = `h${Math.min(level, 6)}`;
        elements.push(
          <HeadingTag key={`h-${i}`} className="wiki-heading">
            {headingTokens.map((t, j) => renderToken(t, `h-${i}-${j}`, true, semanticReveals))}
          </HeadingTag>
        );
        break;
      }
      case 'paragraph_start': {
        const paraTokens = [];
        i++;
        while (i < tokens.length && tokens[i].type !== 'paragraph_end') {
          paraTokens.push(tokens[i]);
          i++;
        }
        elements.push(
          <p key={`p-${i}`} className="wiki-paragraph">
            {paraTokens.map((t, j) => renderToken(t, `p-${i}-${j}`, false, semanticReveals))}
          </p>
        );
        break;
      }
      case 'list_start': {
        const listItems = [];
        i++;
        while (i < tokens.length && tokens[i].type !== 'list_end') {
          if (tokens[i].type === 'list_item_start') {
            const itemTokens = [];
            i++;
            while (i < tokens.length && tokens[i].type !== 'list_item_end') {
              itemTokens.push(tokens[i]);
              i++;
            }
            listItems.push(
              <li key={`li-${i}`} className="wiki-list-item">
                {itemTokens.map((t, j) => renderToken(t, `li-${i}-${j}`, false, semanticReveals))}
              </li>
            );
          }
          i++;
        }
        elements.push(<ul key={`ul-${i}`} className="wiki-list">{listItems}</ul>);
        break;
      }
      case 'image_placeholder':
        elements.push(<ImagePlaceholder key={`img-${i}`} />);
        break;
      default:
        break;
    }
    i++;
  }
  return <>{elements}</>;
}

// Infobox Pokémon
function Infobox({ tokens, semanticReveals }) {
  const rows = [];
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i].type === 'infobox_row_start') {
      let label = [];
      let value = [];
      i++;

      if (tokens[i]?.type === 'infobox_label_start') {
        i++;
        while (i < tokens.length && tokens[i].type !== 'infobox_label_end') {
          label.push(tokens[i]);
          i++;
        }
        i++;
      }

      if (tokens[i]?.type === 'infobox_value_start') {
        i++;
        while (i < tokens.length && tokens[i].type !== 'infobox_value_end') {
          value.push(tokens[i]);
          i++;
        }
        i++;
      }

      rows.push(
        <div key={`row-${i}`} className="infobox-row">
          <div className="infobox-label">
            {label.map((t, j) => renderToken(t, `lb-${i}-${j}`, false, semanticReveals))}
          </div>
          <div className="infobox-value">
            {value.map((t, j) => renderToken(t, `vl-${i}-${j}`, false, semanticReveals))}
          </div>
        </div>
      );
    }
    i++;
  }

  if (rows.length === 0) return null;

  return (
    <div className="infobox">
      <div className="infobox-image">
        <div className="image-placeholder-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
          </svg>
        </div>
      </div>
      {rows}
    </div>
  );
}

// Jeu principal
function Game({ mode }) {
  const [puzzle, setPuzzle] = useState(null);
  const [originalTokens, setOriginalTokens] = useState([]);
  const [originalInfoboxTokens, setOriginalInfoboxTokens] = useState([]);
  const [originalTitleTokens, setOriginalTitleTokens] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [infoboxTokens, setInfoboxTokens] = useState([]);
  const [titleTokens, setTitleTokens] = useState([]);
  const [semanticHints, setSemanticHints] = useState({});
  const [semanticReveals, setSemanticReveals] = useState({});
  const [input, setInput] = useState('');
  const [guesses, setGuesses] = useState([]);
  const [won, setWon] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [wordsFound, setWordsFound] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [lastGuessResult, setLastGuessResult] = useState(null);
  const inputRef = useRef(null);

  const storageKey = `pokepediatix-${mode}`;

  // Charger le puzzle
  useEffect(() => {
    const filename = mode === 'pokemon' ? '/pokemon_puzzle.json' : '/wiki_puzzle.json';

    fetch(filename)
      .then(res => res.json())
      .then(data => {
        setPuzzle(data);

        // Stocker les originaux (deep copy)
        const tokensOriginal = JSON.parse(JSON.stringify(data.tokens || []));
        const infoboxOriginal = JSON.parse(JSON.stringify(data.infoboxTokens || []));
        const titleOriginal = JSON.parse(JSON.stringify(data.titleTokens || []));

        setOriginalTokens(tokensOriginal);
        setOriginalInfoboxTokens(infoboxOriginal);
        setOriginalTitleTokens(titleOriginal);

        setTokens(data.tokens || []);
        setInfoboxTokens(data.infoboxTokens || []);
        setTitleTokens(data.titleTokens || []);
        setTotalWords(data.stats?.hiddenWords || 0);
        setSemanticHints(data.semanticHints || {});

        // Restaurer l'état
        const savedDate = localStorage.getItem(`${storageKey}-date`);
        const today = new Date().toISOString().split('T')[0];

        if (savedDate === today) {
          const savedGuesses = localStorage.getItem(`${storageKey}-guesses`);
          const savedSemantic = localStorage.getItem(`${storageKey}-semantic`);
          const savedWon = localStorage.getItem(`${storageKey}-won`);

          if (savedGuesses) {
            const previousGuesses = JSON.parse(savedGuesses);
            setGuesses(previousGuesses);
            applyGuessesToTokens(data.tokens, data.infoboxTokens, data.titleTokens, previousGuesses, setTokens, setInfoboxTokens, setTitleTokens, setWordsFound);
          }
          if (savedSemantic) {
            setSemanticReveals(JSON.parse(savedSemantic));
          }
          if (savedWon === 'true') {
            setWon(true);
          }
        }
      })
      .catch(err => console.error('Erreur:', err));
  }, [mode, storageKey]);

  // Appliquer les guesses
  const applyGuessesToTokens = (tokenList, infoboxList, titleList, guessList, setT, setI, setTitle, setFound) => {
    const normalizedGuesses = new Set(guessList.map(g => normalizeText(g)));
    let found = 0;

    const revealWord = (token) => {
      if (token.type === 'word' && normalizedGuesses.has(token.normalized)) {
        found++;
        return { ...token, revealed: true };
      }
      return token;
    };

    setT(tokenList.map(revealWord));
    setI(infoboxList.map(revealWord));
    setTitle(titleList.map(revealWord));
    setFound(found);
  };

  // Sauvegarder
  useEffect(() => {
    if (guesses.length > 0 || won) {
      const today = new Date().toISOString().split('T')[0];
      localStorage.setItem(`${storageKey}-date`, today);
      localStorage.setItem(`${storageKey}-guesses`, JSON.stringify(guesses));
      localStorage.setItem(`${storageKey}-semantic`, JSON.stringify(semanticReveals));
      localStorage.setItem(`${storageKey}-won`, won.toString());
    }
  }, [guesses, semanticReveals, won, storageKey]);

  // Reset
  const handleReset = () => {
    // Restaurer les tokens originaux
    setTokens(JSON.parse(JSON.stringify(originalTokens)));
    setInfoboxTokens(JSON.parse(JSON.stringify(originalInfoboxTokens)));
    setTitleTokens(JSON.parse(JSON.stringify(originalTitleTokens)));
    setGuesses([]);
    setSemanticReveals({});
    setWordsFound(0);
    setWon(false);
    setShowAll(false);
    setLastGuessResult(null);

    // Effacer le localStorage
    localStorage.removeItem(`${storageKey}-guesses`);
    localStorage.removeItem(`${storageKey}-semantic`);
    localStorage.removeItem(`${storageKey}-won`);

    inputRef.current?.focus();
  };

  // Soumettre
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || won) return;

    const guess = input.trim();
    const normalizedGuess = normalizeText(guess);

    if (guesses.some(g => normalizeText(g) === normalizedGuess)) {
      setLastGuessResult({ type: 'already', word: guess });
      setInput('');
      return;
    }

    const newGuesses = [...guesses, guess];
    setGuesses(newGuesses);

    let occurrences = 0;
    const revealWord = (token) => {
      if (token.type === 'word' && !token.revealed && token.normalized === normalizedGuess) {
        occurrences++;
        return { ...token, revealed: true };
      }
      return token;
    };

    const newTokens = tokens.map(revealWord);
    const newInfoboxTokens = infoboxTokens.map(revealWord);
    const newTitleTokens = titleTokens.map(revealWord);

    setTokens(newTokens);
    setInfoboxTokens(newInfoboxTokens);
    setTitleTokens(newTitleTokens);

    if (occurrences > 0) {
      setWordsFound(prev => prev + occurrences);
      setLastGuessResult({ type: 'found', word: guess, count: occurrences });
      setSemanticReveals(prev => {
        const updated = { ...prev };
        delete updated[normalizedGuess];
        return updated;
      });
    } else {
      const hints = semanticHints[normalizedGuess];
      if (hints && hints.length > 0) {
        const newSemanticReveals = { ...semanticReveals };
        let bestScore = 0;
        hints.forEach(hint => {
          if (hint.score > (newSemanticReveals[hint.target] || 0)) {
            newSemanticReveals[hint.target] = hint.score;
            bestScore = Math.max(bestScore, hint.score);
          }
        });
        setSemanticReveals(newSemanticReveals);
        setLastGuessResult({ type: 'semantic', word: guess, score: Math.round(bestScore * 100) });
      } else {
        setLastGuessResult({ type: 'notfound', word: guess });
      }
    }

    // Vérifier victoire
    const titleComplete = newTitleTokens.filter(t => t.type === 'word').every(t => t.revealed);
    if (titleComplete && !won) {
      setWon(true);
    }

    setInput('');
    inputRef.current?.focus();
  };

  // Révéler tout
  const handleRevealAll = () => {
    const revealAll = (token) => token.type === 'word' ? { ...token, revealed: true } : token;
    setTokens(tokens.map(revealAll));
    setInfoboxTokens(infoboxTokens.map(revealAll));
    setTitleTokens(titleTokens.map(revealAll));
    setShowAll(true);
  };

  const progressPercent = totalWords > 0 ? Math.round((wordsFound / totalWords) * 100) : 0;

  if (!puzzle) {
    return (
      <div className="game-loading">
        <div className="pokeball" />
        <p>Chargement...</p>
      </div>
    );
  }

  const titleText = titleTokens.filter(t => t.type === 'word').map(t => t.value).join(' ');

  return (
    <div className="game">
      {/* Titre */}
      <header className="wiki-header">
        <h1 className="wiki-title">
          {titleTokens.map((token, i) => (
            token.type === 'word' ? (
              <Word key={i} token={token} isTitle semanticScore={semanticReveals[token.normalized]} />
            ) : token.type === 'space' ? (
              <span key={i}> </span>
            ) : (
              <span key={i}>{token.value}</span>
            )
          ))}
        </h1>
      </header>

      {/* Progression */}
      <div className="progress-section">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <span className="progress-text">{wordsFound}/{totalWords}</span>
      </div>

      {/* Input */}
      {!won && (
        <form className="input-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Proposez un mot..."
            className="guess-input"
            autoFocus
            autoComplete="off"
          />
          <button type="submit" className="btn-submit">OK</button>
          <button type="button" className="btn-reset" onClick={handleReset} title="Recommencer">
            ↺
          </button>
        </form>
      )}

      {/* Victoire */}
      {won && (
        <div className="victory-banner">
          <div className="victory-content">
            <span className="victory-emoji">🎉</span>
            <span className="victory-text">
              <strong>{titleText}</strong> trouvé en {guesses.length} essai{guesses.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="victory-actions">
            {!showAll && (
              <button onClick={handleRevealAll} className="btn-action">
                Tout révéler
              </button>
            )}
            <a
              href={`https://www.pokepedia.fr/${encodeURIComponent(titleText.replace(/ /g, '_'))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-action btn-primary"
            >
              Voir sur Poképédia
            </a>
            <button onClick={handleReset} className="btn-action">
              Recommencer
            </button>
          </div>
        </div>
      )}

      {/* Résultat */}
      {lastGuessResult && !won && (
        <div className={`guess-result ${lastGuessResult.type}`}>
          {lastGuessResult.type === 'found' && `+${lastGuessResult.count} : ${lastGuessResult.word}`}
          {lastGuessResult.type === 'semantic' && `~${lastGuessResult.score}% : ${lastGuessResult.word}`}
          {lastGuessResult.type === 'notfound' && `✗ ${lastGuessResult.word}`}
          {lastGuessResult.type === 'already' && `Déjà proposé`}
        </div>
      )}

      {/* Contenu */}
      <div className={`wiki-content ${mode === 'pokemon' ? 'with-infobox' : ''}`}>
        {mode === 'pokemon' && infoboxTokens.length > 0 && (
          <Infobox tokens={infoboxTokens} semanticReveals={semanticReveals} />
        )}
        <div className="wiki-text">
          <StructuredContent tokens={tokens} semanticReveals={semanticReveals} />
        </div>
      </div>

      {/* Propositions */}
      {guesses.length > 0 && (
        <div className="guesses-section">
          <div className="guesses-list">
            {[...guesses].reverse().slice(0, 30).map((guess, i) => (
              <span key={i} className="guess-chip">{guess}</span>
            ))}
            {guesses.length > 30 && <span className="guess-chip more">+{guesses.length - 30}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// Application
function App() {
  const [activeTab, setActiveTab] = useState('pokemon');
  const [showHint, setShowHint] = useState(false);
  const [hint, setHint] = useState(null);

  useEffect(() => {
    const filename = activeTab === 'pokemon' ? '/pokemon_puzzle.json' : '/wiki_puzzle.json';
    fetch(filename)
      .then(res => res.json())
      .then(data => setHint(data.hint))
      .catch(() => {});
  }, [activeTab]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo">PokepediaTIx</span>
        </div>
        <nav className="tabs">
          <button
            className={`tab ${activeTab === 'pokemon' ? 'active' : ''}`}
            onClick={() => setActiveTab('pokemon')}
          >
            Pokémon
          </button>
          <button
            className={`tab ${activeTab === 'wiki' ? 'active' : ''}`}
            onClick={() => setActiveTab('wiki')}
          >
            Wiki
          </button>
        </nav>
        <div className="header-right">
          <button className="btn-hint" onClick={() => setShowHint(!showHint)} title="Indice">
            ?
          </button>
        </div>
      </header>

      {showHint && hint && (
        <div className="hint-bar">
          Commence par <strong>{hint.firstLetter}</strong> • {hint.wordCount} mot{hint.wordCount > 1 ? 's' : ''}
        </div>
      )}

      <main className="main">
        <Game key={activeTab} mode={activeTab} />
      </main>

      <footer className="footer">
        <span>Inspiré par Pédantix</span>
        <span className="footer-sep">•</span>
        <a href="https://www.pokepedia.fr" target="_blank" rel="noopener noreferrer">Poképédia</a>
      </footer>
    </div>
  );
}

export default App;
