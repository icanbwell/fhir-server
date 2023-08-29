class BaseConverter {
    /**
     * converts a FHIR resource to summary text
     * @param {Resource} resource
     * @returns {Promise<string>}
     */
    // eslint-disable-next-line no-unused-vars
    async convertAsync({resource}) {
        throw new Error('Not Implemented by subclass');
    }

    getDisplayText(codingArray) {
        const coding = codingArray ? codingArray.find((item) => item.display) : undefined;
        return coding ? coding.display : '';
    }

    formatDate(dateString) {
        if (!dateString) {
            return '';
        }
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'});
    }

    /**
     * if value is defined then it formats the template with the value and returns it otherwise returns undefined
     * @param {string} template
     * @param {*} value
     * @return {string}
     */
    addSafeText({template, value}) {
        if (value) {
            return template;
        }
    }

    /**
     * return valueString of the extension with the given url
     * @param {string} title
     * @param {Extension|Extension[]} extension
     * @param {string} url
     * @return {string[]}
     */
    getExtensionValue({title, extension, url}) {
        if (!extension) {
            return [];
        }
        if (!Array.isArray(extension)) {
            extension = [extension];
        }
        const extension1 = extension && extension.find((ext) => ext.url === url);
        if (!extension1) {
            return [];
        }
        if (extension1.valueString) {
            return [
                `###${title}\n${extension1.valueString}`
            ];
        }
        if (extension1.valueDecimal) {
            return [
                `###${title}\n${extension1.valueDecimal}`
            ];
        }
        return [];
    }

    /**
     * returns the text for the given address
     * @param {string} title
     * @param {Address|Address[]} address
     * @return {string[]|*[]}
     */
    getAddresses({title, address}) {
        if (!address) {
            return [];
        }
        if (!Array.isArray(address)) {
            address = [address];
        }

        const textArray = [
            `### ${title}`
        ];
        for (const address1 of address) {
            const addressParts = [];
            if (address1.line && address1.line.length > 0) {
                addressParts.push(address1.line.join(' '));
            }
            if (address1.city) {
                addressParts.push(address1.city);
            }
            if (address1.state) {
                addressParts.push(address1.state);
            }
            if (address1.postalCode) {
                addressParts.push(address1.postalCode);
            }
            if (address1.country) {
                addressParts.push(address1.country);
            }
            if (addressParts && addressParts.length > 0) {
                textArray.push(`- ${addressParts.join(', ')}`);
            }
        }
        return textArray;
    }

    /**
     * returns the text for the given contactPoint
     * @param {string} title
     * @param {ContactPoint|ContactPoint[]} contactPoint
     * @return {string[]}
     */
    getContactPoint({title, contactPoint}) {
        if (!contactPoint) {
            return [];
        }
        if (!Array.isArray(contactPoint)) {
            contactPoint = [contactPoint];
        }

        const textArray = [
            `### ${title}`
        ];
        for (const contact of contactPoint) {
            const contactParts = [];
            if (contact.system) {
                contactParts.push(`System: ${contact.system}`);
            }
            if (contact.value) {
                contactParts.push(`Value: ${contact.value}`);
            }
            if (contact.use) {
                contactParts.push(`Use For: ${contact.use}`);
            }
            if (contactParts && contactParts.length > 0) {
                textArray.push(`- ${contactParts.join(', ')}`);
            }
        }
        return textArray;
    }

    /**
     *
     * @param {string} title
     * @param {HumanName|HumanName[]} name
     * @return {string[]}
     */
    getName({title, name}) {
        if (!name || name.length === 0) {
            return [];
        }
        if (!Array.isArray(name)) {
            name = [name];
        }

        const textArray = [
            `### ${title}`
        ];
        for (const name1 of name) {
            let fullName = '';
            if (name1.family) {
                fullName += `${name1.family}, `;
            }
            if (name1.given) {
                fullName += name1.given.join(' ');
            }
            textArray.push(`- ${fullName}`);
        }
        return textArray;
    }

    /**
     * returns the text for the given date
     * @param {string} title
     * @param {Date} date
     * @return {string[]}
     */
    getDate({title, date}) {
        if (!date) {
            return [];
        }
        const textArray = [
            `### ${title}`,
            `${this.formatDate(date)}`
        ];
        return textArray;
    }

    /**
     * returns the text for the given identifier
     * @param {string} title
     * @param {Identifier|Identifier[]} identifier
     * @return {string[]}
     */
    getIdentifiers({title, identifier}) {
        if (!identifier || identifier.length === 0) {
            return [];
        }
        if (!Array.isArray(identifier)) {
            identifier = [identifier];
        }

        const textArray = [
            `### ${title}`
        ];
        for (const identifier1 of identifier) {
            const identifierParts = [];
            identifierParts.push('Identifier');
            if (identifier1.use) {
                identifierParts.push(`\t- Use For: ${identifier1.use}`);
            }
            if (identifier1.system) {
                identifierParts.push(`\t- System: ${identifier1.system}`);
            }
            if (identifier1.value) {
                identifierParts.push(`\t- Value: ${identifier1.value}`);
            }
            if (identifier1.type && identifier1.type.length > 0 && identifier1.type[0].text) {
                const firstType = identifier1.type[0];
                identifierParts.push(`\t- Type: ${firstType.text}`);
            }
            textArray.push(`- ${identifierParts.join('\n')}`);
        }
        return textArray;
    }

    /**
     * returns the text for the given text or code
     * @param {string} title
     * @param {string|string[]|undefined} text
     * @return {string[]|*[]}
     */
    getText({title, text}) {
        if (!text) {
            return [];
        }
        const textArray = [
            `### ${title}`
        ];
        if (Array.isArray(text)) {
            for (const text1 of text) {
                textArray.push(`- ${text1}`);
            }
        } else {
            textArray.push(`${text}`);
        }
        return textArray;
    }

    /**
     * returns the text for the given codeableConcept
     * @param {string} title
     * @param {CodeableConcept|CodeableConcept[]|undefined} codeableConcept
     * @return {string[]}
     */
    getCodeableConcept({title, codeableConcept}) {
        if (!codeableConcept) {
            return [];
        }
        if (!Array.isArray(codeableConcept)) {
            codeableConcept = [codeableConcept];
        }
        if (codeableConcept.length === 0) {
            return [];
        }
        const textArray = [
            `### ${title}`
        ];
        for (const codeableConcept1 of codeableConcept) {
            if (codeableConcept1.text) {
                textArray.push(`- ${codeableConcept1.text}`);
            } else if (codeableConcept1.coding && codeableConcept1.coding.length > 0) {
                const firstCoding = codeableConcept1.coding[0];
                if (firstCoding.display) {
                    textArray.push(`- ${firstCoding.display}`);
                } else if (firstCoding.code) {
                    textArray.push(`- ${firstCoding.code}`);
                }
            }
            if (codeableConcept1.coding && codeableConcept1.coding.length > 0) {
                for (const coding1 of codeableConcept1.coding) {
                    textArray.push(`\t- ${coding1.code} (${coding1.system})`);
                }
            }
        }
        return textArray;
    }
}

module.exports = {
    BaseConverter
};
