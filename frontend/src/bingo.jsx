import React from "react"

export default function Bingo(props) {
    const disabled = props.disabled;
    const styles = {
        backgroundColor: props.isHeld ? "#59E391" : "white",
        opacity: disabled && !props.isHeld ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer'
    };
    return (
        <button
            style={styles}
            onClick={disabled ? undefined : props.hold}
            aria-pressed={props.isHeld}
            disabled={disabled}
            aria-label={`Cell with value ${props.value}, ${props.isHeld ? 'held' : 'not held'}${disabled ? ', disabled' : ''}`}
        >{props.value}</button>
    );
}