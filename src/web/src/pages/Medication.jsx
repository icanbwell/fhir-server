import React from "react";
import {Typography} from "@mui/material";
import CodeableConcept from '../partials/CodeableConcept';
import Reference from '../partials/Reference';
import Ratio from '../partials/Ratio';

function Medication({resource}) {
    return (
        <div>
            {resource.manufacturer && (
                <>
                    <Typography variant="h4">Status: {resource.status}</Typography>
                    <CodeableConcept
                        resourceType={resource.resourceType}
                        codeableConcepts={[resource.code]}
                        name="Code"
                        searchParameter="code"
                    />
                </>
            )}

            {resource.manufacturer && (
                <Reference
                    references={[resource.manufacturer]}
                    name="Manufacturer"
                />
            )}

            <CodeableConcept
                resourceType={resource.resourceType}
                codeableConcepts={[resource.form]}
                name="Form"
                searchParameter="form"
            />

            <Ratio ratio={resource.amount} name="Amount"/>

            {resource.ingredient && (
                <>
                    <Typography variant="h4">Ingredients</Typography>
                    {resource.ingredient.map((ingredient, index) => (
                        <div key={index}>
                            <Typography variant="h4">Ingredient {index + 1}</Typography>
                            {ingredient.itemCodeableConcept && (
                                <CodeableConcept
                                    resourceType={resource.resourceType}
                                    codeableConcepts={[ingredient.itemCodeableConcept]}
                                    name="Ingredient Code"
                                    searchParameter=""
                                />
                            )}
                            {ingredient.isActive && (
                                <Typography variant="h5">
                                    Active: {ingredient.isActive}
                                </Typography>
                            )}
                            <Ratio ratio={ingredient.strength} name="Strength"/>
                        </div>
                    ))}
                </>
            )}

            {resource.batch && (
                <>
                    {resource.batch.lotNumber && (
                        <Typography variant="h4">
                            Batch Lot Number: {resource.batch.lotNumber}
                        </Typography>
                    )}
                    {resource.batch.expirationDate && (
                        <Typography variant="h4">
                            Batch Lot Expiration Date: {resource.batch.expirationDate}
                        </Typography>
                    )}
                </>
            )}
        </div>
    );
}

export default Medication;
