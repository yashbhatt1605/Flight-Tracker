import React, { useState, useCallback } from "react";
import Globe from "./Globe";
import PlaneDetails from "./PlaneDetails";
import "./App.css";

export default function App() {
    const [selectedPlane, setSelectedPlane] = useState(null);

    const handleSelectPlane = useCallback((plane) => {
        setSelectedPlane(plane);
    }, []);

    const handleClose = useCallback(() => {
        setSelectedPlane(null);
    }, []);

    return (
        <div className="app">
            <Globe setSelectedPlane={handleSelectPlane} />
            {/* PlaneDetails is always in DOM — shows/hides via CSS right: property */}
            <PlaneDetails plane={selectedPlane} onClose={handleClose} />
        </div>
    );
}