import { test } from "../../fixtures/checkmate-live"

test.describe('itinerary flows', async () => {
    test('quote - compact', async ({ ai }) => {
        await test.step('Login and Open XYZ QA App', async () => {
            await ai.run({
                action: `
                Login to Salesforce and open XYZ QA Application: 
                Open the browser and navigate to the org,
                Navigate to Salesforce org and use the App Launcher to open 'XYZ QA'.`,
                expect: `
                Salesforce org loads successfully 
                and XYZ QA homepage is displayed with the 'Itineraries' tab active.`
            })
        })
        await test.step('Create and Setup New Quote Itinerary', async () => {
            await ai.run({
                action: `
                Create a new Quote Itinerary:
                Click 'New', select 'Quote' record type, click 'Next', and fill out the main itinerary fields 
                ('Itinerary Name' = 'Agentic Itinerary', 'Account' and 'Primary Contact' = 'Abi Tester', 
                'Channel' = 'XYZ Tours Europe', 'Group Size' = '1', 'Itinerary Start Date' = '31/10/2025'), 
                then click 'Save'.`,
                expect: `
                The new itinerary is saved 
                and the details page for 'Agentic Itinerary' is displayed after loading.`
            })
        })

        await test.step('Configure Primary Locations to Europe', async () => {
            await ai.run({
                action: `
                In the itinerary, click 'Builder' tab, filter and select 'Europe' as the primary location 
                and save the selection.`,
                expect: `
                'Primary Locations' modal closes, 
                and 'Europe' is set as a primary location in the itinerary builder.`
            })
        })
        await test.step('Add 3 Service Line Items', async () => {
            await ai.run({
                action: `
                Add the following service line items:
                1. Accommodation: 'AB Test Hotel', 'No Location', '1 room'
                2. Activity: 'Cave Tours', 'No Location'
                3. Flight: 'Brussels - Warsaw', 'No Location'`,
                expect: `
                All three line items appear in the itinerary builder,
                each configured with the correct type and service.`
            })
        })
        await test.step('Update Total Cost for Flight', async () => {
            await ai.run({
                action: `
                On the 'Costings' tab for the Flight line item,
                edit 'Gross Price' by setting 'Supplier Cost' to '2000' in the modal,
                then save. 
                ###TIPS###:
                You need to clear the value first, then type '2000',
                then click something else in the modal before saving.`,
                expect: `
                The Flight Unit Cost is increased by at least 2000 from the original value.`
            })
        })
    })

    test('quote - detailed', async ({ ai }) => {
        await test.step('Login to Salesforce', async () => {
            await ai.run({
                action: `
                Login to Salesforce: Open the browser and navigate to the org`,
                expect: `
                Salesforce org is loaded successfully and is not on the login page.`
            })
        })
        await test.step('Open App Launcher', async () => {
            await ai.run({
                action: `
                Click the App Launcher icon (nine dots) in the top left corner.`,
                expect: `
                App Launcher menu is opened.`
            })
        })
        await test.step('Find and Select XYZ QA Application', async () => {
            await ai.run({
                action: `
                Type 'XYZ QA' into the App Launcher search bar 
                and click on 'XYZ QA' from the search results.`,
                expect: `
                The application navigates to the XYZ QA homepage, 
                with the 'Itineraries' tab active and a list of itineraries displayed.`
            })
        })
        await test.step('Click New on Itineraries Page', async () => {
            await ai.run({
                action: `
                Click the 'New' button on the Itineraries page.`,
                expect: `
                The record type selection modal appears.`
            })
        })
        await test.step('Select Quote Record Type and Proceed', async () => {
            await ai.run({
                action: `
                Select the 'Quote' record type and click the 'Next' button.`,
                expect: `
                The 'New Itinerary' form loads, displaying various fields such as 
                'Itinerary Name', 'Account', 'Primary Contact', 'Channel', 'Status', 
                'Currency', 'Language', 'Group Size', 'Itinerary Start Date', 
                'Itinerary End Date', and 'Description'.`
            })
        })
        await test.step('Populate New Itinerary Details', async () => {
            await ai.run({
                action: `
                Enter 'Agentic Itinerary' into the 'Itinerary Name' field, 
                type 'Abi Tester' into both the 'Account' and 'Primary Contact' fields, 
                select 'XYZ Tours Europe' from the 'Channel' dropdown, 
                and enter '1' into the 'Group Size' field, 
                set the 'Itinerary Start Date' to future date (e.g. 31/10/2025).`,
                expect: `
                All required itinerary details are filled in the form.`
            })
        })
        await test.step('Save New Itinerary', async () => {
            await ai.run({
                action: `
                Click the 'Save' button.`,
                expect: `
                The new itinerary is saved, 
                and the page navigates to the 'Agentic Itinerary' details page. 
                This may take a while to save and load new itinerary details page, 
                be patient after saving the itinerary, wait for the page to load.`
            })
        })
        await test.step('Open Builder Tab', async () => {
            await ai.run({
                action: `
                Click the 'Builder' tab.`,
                expect: `
                'Itinerary Builder' is displayed.`
            })
        })
        await test.step('Add Europe as Primary Location', async () => {
            await ai.run({
                action: `
                Type 'Europe' into the 'Filter Locations' search bar and press 'Enter', 
                select 'Europe' from the 'All Available Locations' list 
                and click the 'Move to Primary Locations' arrow button.`,
                expect: `
                Europe is shown in the Primary Locations list.`
            })
        })
        await test.step('Save Primary Locations', async () => {
            await ai.run({
                action: `
                Click the 'Save' button in the 'Primary Locations' modal.`,
                expect: `
                The 'Primary Locations' modal closes, 
                and the 'Itinerary Builder' is displayed with no items in the builder list.`
            })
        })
        await test.step('Add New Accommodation Line', async () => {
            await ai.run({
                action: `
                Click the 'Add new line' button, 
                select 'Accommodation' as service type, 
                select 'No Location' in the 'Location' column.`,
                expect: `
                'Accommodation' type line item is being created with 'No Location' set.`
            })
        })
        await test.step('Configure Accommodation Service Details', async () => {
            await ai.run({
                action: `
                Select 'AB Test Hotel' in the 'Service' column, 
                select '1 room' in the 'Quantity' field, 
                and click the 'Save' button for the line item.`,
                expect: `
                The line item is saved and displayed in the itinerary builder 
                with the accommodation service configured.`
            })
        })
        await test.step('Add New Activity Line', async () => {
            await ai.run({
                action: `
                Click the 'Add new line' button, 
                select 'Activty' as service type, 
                select 'No Location' in the 'Location' column.`,
                expect: `
                'Activty' type line item is being created with 'No Location' set.`
            })
        })
        await test.step('Configure Activity Service Details', async () => {
            await ai.run({
                action: `
                Select 'Cave Tours' in the 'Service' column, 
                and click the 'Save' button for the line item.`,
                expect: `
                The line item is saved and displayed in the itinerary builder 
                with the activty service configured.`
            })
        })
        await test.step('Add New Flight Line', async () => {
            await ai.run({
                action: `
                Click the 'Add new line' button, 
                select 'Flight' as service type, 
                select 'No Location' in the 'Location' column.`,
                expect: `
                'Flight' type line item is being created with 'No Location' set.`
            })
        })
        await test.step('Configure Flight Service Details', async () => {
            await ai.run({
                action: `
                Select 'Brussels - Warsaw' in the 'Service' column, 
                and click the 'Save' button for the line item.`,
                expect: `
                The line item is saved and displayed in the itinerary builder 
                with the flight service configured.`
            })
        })
        await test.step('Open Costings Tab for Flight', async () => {
            await ai.run({
                action: `
                Open 'Costings' tab, 
                be patient and wait for the records to load, 
                then hover right to 'Gross Price' column on Flight line item, 
                and click on the pencil icon that appears.`,
                expect: `
                Costings modal appears for editing unit cost of Flight line item.`
            })
        })
        await test.step('Set and Save Supplier Cost for Flight', async () => {
            await ai.run({
                action: `
                First clear the value in 'Supplier Cost' field and then set it to '2000' 
                on the Price Lines modal, 
                click on any other field in the modal and then Save changes.`,
                expect: `
                The Flight 'Unit Cost' is at least '2000'.'`
            })
        })
        await test.step('Open Passengers tab', async () => {
            await ai.run({
                action: `
                Open 'Passengers' tab and wait for the table. 
                It may take a while to load without clear indication of progress, be patient.`,
                expect: `
                Passengers tab is loaded with 1 passenger row in a table. 
                It should be ready within 30 seconds.`
            })
        })
        await test.step('Fill in passenger details', async () => {
            await ai.run({
                action: `
                Set fields: 
                'First Name' to 'John', 
                'Last Name' to 'Doe', 
                'Email' to 'john.doe@example.com', 
                'Date of Birth' to '1990-01-01', 
                'Gender' to 'Male'.
                You need to double click in the cell to edit it.
                Scroll down, then Save the changes using the 'Save' button. 
                `,
                expect: `
                The passenger details are filled in.`
            })
        })
        await test.step('Open Details tab', async () => {
            await ai.run({
                action: `
                Open 'Details' tab.`,
                expect: `
                Details tab is opened.`
            })
        })
        await test.step('Convert Itinerary to Booking', async () => {
            await ai.run({
                action: `
                Click the 'Convert to Booking' button.`,
                expect: `
                The itinerary 'Record Type' field is updated to 'Booking', 
                and the 'Status' field is updated to 'Booked'.`
            })
        })
    })
})