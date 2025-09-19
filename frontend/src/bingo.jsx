import React from 'react';

export default function Bingo({ value, isHeld, hold, disabled }) {
    const className = [
        'bingo-cell',
        isHeld ? 'held' : '',
        disabled ? 'disabled' : ''
    ].filter(Boolean).join(' ');
    return (
        <button
            className={className}
            onClick={disabled ? undefined : hold}
            aria-pressed={isHeld}
            disabled={disabled}
            aria-label={`Cell with value ${value}, ${isHeld ? 'held' : 'not held'}${disabled ? ', disabled' : ''}`}
        >{value}</button>
    );
}